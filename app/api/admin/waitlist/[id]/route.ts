import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../lib/db/server";
import { removeFromWaitlist } from "../../../../../lib/db/waitlist";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ok = await removeFromWaitlist(supabase, id, user.id);
  if (!ok) return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  return NextResponse.json({ success: true });
}
