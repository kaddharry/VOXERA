import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { createPatient, listPatients } from "../../../../lib/db/patients";
import { createPatientDocument } from "../../../../lib/db/patient-documents";
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
 * assignedAgentId?, and an optional initial knowledge-base file (PDF or
 * plain text/markdown). `notes` is the manually-typed free-text field only;
 * an uploaded file becomes its own patient_documents row (see
 * migration_v17.sql) instead of being concatenated into notes — more files
 * can be added later via POST /api/admin/patients/[id]/documents without
 * overwriting this one. lib/db/patient-documents.ts's
 * getPatientCallContext() merges notes + every document at call time.
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
  const notes = String(formData.get("notes") ?? "").trim();
  const file = formData.get("file");

  if (!name) return NextResponse.json({ error: "Patient name is required." }, { status: 400 });
  if (!phone) return NextResponse.json({ error: "Phone number is required." }, { status: 400 });

  let fileDoc: { filename: string; mimeType: string | null; extractedText: string } | null = null;
  if (file instanceof File) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `File too large (max ${MAX_FILE_BYTES / (1024 * 1024)}MB).` }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      const extracted =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
          ? await extractPdfText(buffer)
          : buffer.toString("utf-8");
      fileDoc = { filename: file.name, mimeType: file.type || null, extractedText: extracted.trim() };
    } catch (err: any) {
      return NextResponse.json({ error: `Failed to read knowledge base file: ${err.message}` }, { status: 400 });
    }
  }

  if (!notes && !fileDoc?.extractedText) {
    return NextResponse.json({ error: "Upload a knowledge base file or enter context manually." }, { status: 400 });
  }

  const patient = await createPatient(supabase, user.id, { name, phone, notes, assignedAgentId });
  if (!patient) return NextResponse.json({ error: "Failed to create patient" }, { status: 500 });

  if (fileDoc?.extractedText) {
    const document = await createPatientDocument(supabase, user.id, { patientId: patient.id, ...fileDoc });
    if (!document) {
      // Patient itself was created fine; only the document insert failed.
      // Not worth failing the whole request over — surface it so the UI can
      // tell the user to re-upload rather than silently losing the file.
      return NextResponse.json({ patient, warning: "Patient saved, but the file failed to attach. Try re-uploading it from the patient's page." }, { status: 201 });
    }
  }

  return NextResponse.json({ patient }, { status: 201 });
}
