import { NextResponse } from "next/server";
import { createClient } from "../../../lib/db/server";
import { listFollowUpTasks } from "../../../lib/db/follow-up-tasks";

export const dynamic = "force-dynamic";

/** GET /api/follow-ups — every scheduled/in-flight follow-up for this
 * tenant, across all patients, for the Follow-up Schedule list page.
 * Patient name/phone are looked up separately rather than via a PostgREST
 * embed, to keep this independent of exact FK-embedding syntax. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tasks = await listFollowUpTasks(supabase, user.id);

  const patientIds = [...new Set(tasks.map((t) => t.patientId))];
  const { data: patients } = patientIds.length
    ? await supabase.from("patients").select('id, name, phone').eq("clientId", user.id).in("id", patientIds)
    : { data: [] as { id: string; name: string; phone: string }[] };
  const patientById = new Map((patients ?? []).map((p) => [p.id, p]));

  const tasksWithPatient = tasks.map((t) => ({ ...t, patient: patientById.get(t.patientId) ?? null }));
  return NextResponse.json({ tasks: tasksWithPatient });
}
