import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "../../../../../../../lib/auth/access";
import { deletePatientDocument } from "../../../../../../../lib/db/patient-documents";

export const dynamic = "force-dynamic";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const guard = await requireAccess("patients.write");
  if (!guard.ok) return guard.response;
  const supabase = guard.access.db;
  const user = { id: guard.access.clientId };

  const { docId } = await params;
  const ok = await deletePatientDocument(supabase, docId, user.id);
  if (!ok) return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
  return NextResponse.json({ success: true });
}
