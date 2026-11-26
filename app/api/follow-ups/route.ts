import { requireAccess } from "../../../lib/auth/access";
import { NextResponse } from "next/server";
import { listFollowUpTasks } from "../../../lib/db/follow-up-tasks";

export const dynamic = "force-dynamic";

/** GET /api/follow-ups — every scheduled/in-flight follow-up for this
 * tenant, across all patients, for the Follow-up Schedule list page.
 * Patient name/phone are looked up separately rather than via a PostgREST
 * embed, to keep this independent of exact FK-embedding syntax. */
export async function GET() {
  const guard = await requireAccess("patients.read");
  if (!guard.ok) return guard.response;
  const supabase = guard.access.db;
  const user = { id: guard.access.clientId };

  const tasks = await listFollowUpTasks(supabase, user.id);

  const patientIds = [...new Set(tasks.map((t) => t.patientId))];
  const { data: patients } = patientIds.length
    ? await supabase.from("patients").select('id, name, phone').eq("clientId", user.id).in("id", patientIds)
    : { data: [] as { id: string; name: string; phone: string }[] };
  const patientById = new Map((patients ?? []).map((p) => [p.id, p]));

  const tasksWithPatient = tasks.map((t) => ({ ...t, patient: patientById.get(t.patientId) ?? null }));
  return NextResponse.json({ tasks: tasksWithPatient });
}
