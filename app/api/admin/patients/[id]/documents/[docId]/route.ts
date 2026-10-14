import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../../../lib/db/server";
import { deletePatientDocument } from "../../../../../../../lib/db/patient-documents";

export const dynamic = "force-dynamic";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { docId } = await params;
  const ok = await deletePatientDocument(supabase, docId, user.id);
  if (!ok) return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
  return NextResponse.json({ success: true });
}
