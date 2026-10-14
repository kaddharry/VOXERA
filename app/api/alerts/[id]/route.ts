import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";
import { resolveAlert } from "../../../../lib/db/alerts";

export const dynamic = "force-dynamic";

/** PATCH /api/alerts/[id] — { resolutionNotes? } — marks an alert reviewed. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const alert = await resolveAlert(supabase, id, user.id, typeof body.resolutionNotes === "string" ? body.resolutionNotes : undefined);
  if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ alert });
}
