import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../../../lib/db/server";
import { getPatient } from "../../../../../../../lib/db/patients";
import { archiveFinishedTasks, listFollowUpTasksForPatient, MigrationRequiredError } from "../../../../../../../lib/db/follow-up-tasks";
import { isClearable, scheduleIdOf } from "../../../../../../../lib/scheduler/schedules";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/patients/[id]/schedules/clear-past
 *
 * Hides this patient's finished schedules from the Follow-ups panel. Takes
 * no task ids from the client: which schedules qualify is decided here
 * (isClearable — every day finished, none dated today or later unless it
 * was cancelled), and the update itself re-checks status and ownership.
 * Records are archived, not deleted: call logs, transcripts, summaries and
 * alerts are untouched and remain in Calls & Insights.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tasks = await listFollowUpTasksForPatient(supabase, id, user.id);
  const bySchedule = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const key = scheduleIdOf(t);
    bySchedule.set(key, [...(bySchedule.get(key) ?? []), t]);
  }

  const now = Date.now();
  const eligible = [...bySchedule.values()].filter((group) => isClearable(group, now));
  const taskIds = eligible.flatMap((group) => group.map((t) => t.id));

  try {
    const archived = await archiveFinishedTasks(supabase, user.id, id, taskIds);
    return NextResponse.json({ clearedSchedules: eligible.length, archivedTasks: archived });
  } catch (err) {
    if (err instanceof MigrationRequiredError) return NextResponse.json({ error: err.message }, { status: 503 });
    console.error("[clear-past] failed:", err);
    return NextResponse.json({ error: "Failed to clear past schedules." }, { status: 500 });
  }
}
