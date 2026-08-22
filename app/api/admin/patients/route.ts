import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { createPatient, listPatients } from "../../../../lib/db/patients";
import { extractPdfText } from "../../../../lib/knowledge/pdf";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patients = await listPatients(supabase, user.id);
  return NextResponse.json({ patients });
}

/**
 * POST /api/admin/patients — multipart/form-data: name, phone,
 * assignedAgentId?, and an optional knowledge-base file (PDF or plain
 * text/markdown). Extracted text is stored on patients.notes, the same
 * field lib/agent/orchestrator.ts already injects into the call as
 * "PATIENT CONTEXT" — reuses that existing, already-tested path rather
 * than building a second, patient-scoped RAG/chunking system for what's
 * realistically a single short document per patient.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const assignedAgentId = formData.get("assignedAgentId") ? String(formData.get("assignedAgentId")) : null;
  const manualNotes = String(formData.get("notes") ?? "").trim();
  const file = formData.get("file");

  if (!name) return NextResponse.json({ error: "Patient name is required." }, { status: 400 });
  if (!phone) return NextResponse.json({ error: "Phone number is required." }, { status: 400 });

  let notes = manualNotes;
  if (file instanceof File) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `File too large (max ${MAX_FILE_BYTES / (1024 * 1024)}MB).` }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      let extracted: string;
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        extracted = await extractPdfText(buffer);
      } else {
        extracted = buffer.toString("utf-8");
      }
      notes = [manualNotes, extracted.trim()].filter(Boolean).join("\n\n");
    } catch (err: any) {
      return NextResponse.json({ error: `Failed to read knowledge base file: ${err.message}` }, { status: 400 });
    }
  }

  if (!notes) {
    return NextResponse.json({ error: "Upload a knowledge base file or enter context manually." }, { status: 400 });
  }

  const patient = await createPatient(supabase, user.id, { name, phone, notes, assignedAgentId });
  if (!patient) return NextResponse.json({ error: "Failed to create patient" }, { status: 500 });
  return NextResponse.json({ patient }, { status: 201 });
}
