import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "../../../../lib/auth/access";
import { resolveAlert } from "../../../../lib/db/alerts";

export const dynamic = "force-dynamic";

/** PATCH /api/alerts/[id] — { resolutionNotes? } — marks an alert reviewed. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAccess("alerts.resolve");
  if (!guard.ok) return guard.response;
  const supabase = guard.access.db;
  const user = { id: guard.access.clientId };

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const alert = await resolveAlert(supabase, id, user.id, typeof body.resolutionNotes === "string" ? body.resolutionNotes : undefined);
  if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ alert });
}
