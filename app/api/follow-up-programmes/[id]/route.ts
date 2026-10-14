import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { deleteProgramme } from "../../../../lib/db/follow-up-programmes";

export const dynamic = "force-dynamic";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ok = await deleteProgramme(supabase, id, user.id);
  if (!ok) return NextResponse.json({ error: "Failed to delete programme" }, { status: 500 });
  return NextResponse.json({ success: true });
}
