import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../../lib/db/server";
import { getPatient } from "../../../../../../lib/db/patients";
import { createPatientDocument, listPatientDocuments } from "../../../../../../lib/db/patient-documents";
import { extractPdfText } from "../../../../../../lib/knowledge/pdf";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const documents = await listPatientDocuments(supabase, id, user.id);
  return NextResponse.json({ documents });
}

/**
 * POST /api/admin/patients/[id]/documents — multipart/form-data: a file
 * (PDF or plain text/markdown) and/or a `text` field. Adds a new document
 * to this patient's list without touching any existing one — the gap this
 * replaces was the original patient-add form silently overwriting the
 * single `notes` field on every new upload.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });

  const file = formData.get("file");
  const text = String(formData.get("text") ?? "").trim();

  let filename = "Pasted text";
  let mimeType: string | null = null;
  let extractedText = text;

  if (file instanceof File) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `File too large (max ${MAX_FILE_BYTES / (1024 * 1024)}MB).` }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      extractedText =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
          ? await extractPdfText(buffer)
          : buffer.toString("utf-8");
    } catch (err: any) {
      return NextResponse.json({ error: `Failed to read file: ${err.message}` }, { status: 400 });
    }
    filename = file.name;
    mimeType = file.type || null;
  }

  if (!extractedText.trim()) {
    return NextResponse.json({ error: "Upload a file or enter text." }, { status: 400 });
  }

  const document = await createPatientDocument(supabase, user.id, {
    patientId: id,
    filename,
    mimeType,
    extractedText: extractedText.trim(),
  });
  if (!document) return NextResponse.json({ error: "Failed to save document" }, { status: 500 });
  return NextResponse.json({ document }, { status: 201 });
}
