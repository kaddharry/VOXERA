import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../../lib/db/server";
import { setDoNotContact } from "../../../../../../lib/db/patients";

export const dynamic = "force-dynamic";

/** PATCH /api/admin/patients/[id]/do-not-contact — { value: boolean, reason? }.
 * Staff-initiated equivalent of the automatic detection in
 * app/api/telephony/status/route.ts (spec §17.4). Does NOT cancel pending
 * follow-up tasks itself when set manually from here — unlike the
 * automatic path, a staff member setting this sees the Follow-up Plan tab
 * directly and can decide per-task, since they're already looking at it. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body.value !== "boolean") {
    return NextResponse.json({ error: "value (boolean) is required." }, { status: 400 });
  }

  const patient = await setDoNotContact(supabase, id, user.id, body.value, typeof body.reason === "string" ? body.reason : undefined);
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ patient });
}
