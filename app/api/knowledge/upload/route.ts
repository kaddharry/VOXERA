import type { NextRequest } from "next/server";
import { CONFIG } from "@/lib/config";
import { DEMO, ensureSeeded } from "@/lib/bootstrap";
import { ingestDocument } from "@/lib/knowledge/ingest";
import { createClient } from "@/lib/db/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // Validate MIME type.
  const mimeType = file.type || "application/octet-stream";
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

    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
