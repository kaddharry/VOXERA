import type { NextRequest } from "next/server";
import { CONFIG } from "@/lib/config";
import { DEMO, ensureSeeded } from "@/lib/bootstrap";
import { ingestDocument } from "@/lib/knowledge/ingest";
import { invalidateInlineKnowledgeBase } from "@/lib/knowledge/inline";
import { createClient } from "@/lib/db/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Browsers often report a generic or empty MIME type for these extensions
// (e.g. .md as "" or "application/octet-stream", .csv as
// "application/vnd.ms-excel" on some OSes) — fall back to the extension
// when the reported type isn't one we recognize.
const EXTENSION_MIME_FALLBACK: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".txt": "text/plain",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function resolveMimeType(filename: string, reportedType: string): string {
  if (CONFIG.knowledge.allowedMimeTypes.includes(reportedType)) return reportedType;
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return EXTENSION_MIME_FALLBACK[ext] ?? reportedType;
}

export async function POST(request: NextRequest) {
  await ensureSeeded();

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: "Failed to parse form data" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return Response.json(
      { error: "Missing 'file' field in form data" },
      { status: 400 },
    );
  }

  const supabaseServer = await createClient();
  const { data: { user } } = await supabaseServer.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = user.id;

  // Validate MIME type (with an extension-based fallback for browsers that
  // report generic/empty types for markdown, CSV, etc.).
  const mimeType = resolveMimeType(file.name, file.type || "application/octet-stream");
  if (!CONFIG.knowledge.allowedMimeTypes.includes(mimeType)) {
    return Response.json(
      {
        error: `Unsupported file type: ${mimeType}. Allowed: ${CONFIG.knowledge.allowedMimeTypes.join(", ")}`,
      },
      { status: 400 },
    );
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await ingestDocument({
      clientId,
      filename: file.name,
      content: buffer,
      mimeType,
    });

    // This client's LTM_client chunk set just changed — drop any cached
    // inline-KB text (or cached "too large" verdict) so the next turn
    // re-derives it instead of serving stale/missing content.
    invalidateInlineKnowledgeBase(clientId);

    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
