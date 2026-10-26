import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../../../lib/db/server";
import { getPatient } from "../../../../../../../lib/db/patients";
import { getAgentForTenant, getTenantIdForUser } from "../../../../../../../lib/db/agents";
import {
  applyScheduleEdit,
  listFollowUpTasksForPatient,
  MigrationRequiredError,
  type FollowUpTaskRecord,
} from "../../../../../../../lib/db/follow-up-tasks";
import { groupSchedules, planScheduleEdit, scheduleIdOf, scheduleKindOf, type ScheduleEdit } from "../../../../../../../lib/scheduler/schedules";
import { isValidTimeZone } from "../../../../../../../lib/scheduler/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; scheduleId: string }> };

type Loaded =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      user: { id: string };
      patient: NonNullable<Awaited<ReturnType<typeof getPatient>>>;
      scheduleId: string;
      kind: NonNullable<ReturnType<typeof scheduleKindOf>>;
      tasks: FollowUpTaskRecord[];
    };

async function loadSchedule(params: Params["params"]): Promise<Loaded> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { id, scheduleId: rawScheduleId } = await params;
  const scheduleId = decodeURIComponent(rawScheduleId);
  const patient = await getPatient(supabase, id, user.id);
  if (!patient) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  // Scoped to this tenant and patient by listFollowUpTasksForPatient.
  const allTasks = await listFollowUpTasksForPatient(supabase, id, user.id);
  const tasks = allTasks.filter((t) => scheduleIdOf(t) === scheduleId);
  const kind = scheduleKindOf(scheduleId);
  if (!kind || tasks.length === 0) return { ok: false, response: NextResponse.json({ error: "Schedule not found" }, { status: 404 }) };

  return { ok: true, supabase, user, patient, scheduleId, kind, tasks };
}

/**
 * GET /api/admin/patients/[id]/schedules/[scheduleId]
 * One schedule with what actually happened on each day: the calls placed
 * (time, status, duration, outcome) and any review alerts raised.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const loaded = await loadSchedule(params);
  if (!loaded.ok) return loaded.response;
  const { supabase, user, tasks } = loaded;

  const now = Date.now();
  const [schedule] = groupSchedules(tasks, now);
  const taskIds = tasks.map((t) => t.id);

  const [{ data: calls }, { data: alerts }] = await Promise.all([
    supabase
      .from("call_logs")
      .select('id, "sessionId", status, "startedAt", "endedAt", "durationMs", summary, "followUpTaskId"')
      .eq("clientId", user.id)
      .in("followUpTaskId", taskIds)
      .order("startedAt", { ascending: true }),
    supabase
      .from("alerts")
      .select('id, reason, status, "createdAt", "followUpTaskId"')
      .eq("clientId", user.id)
      .in("followUpTaskId", taskIds)
      .order("createdAt", { ascending: true }),
  ]);

  return NextResponse.json({
    schedule,
    now,
    calls: (calls ?? []).map((c) => ({
      id: c.id,
      sessionId: c.sessionId,
      taskId: c.followUpTaskId,
      status: c.status,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      durationMs: c.durationMs,
      outcome: (c.summary as { followUpOutcome?: string } | null)?.followUpOutcome ?? null,
    })),
    alerts: (alerts ?? []).map((a) => ({ id: a.id, taskId: a.followUpTaskId, reason: a.reason, status: a.status, createdAt: a.createdAt })),
  });
}

/**
 * PATCH /api/admin/patients/[id]/schedules/[scheduleId]
 * Edits a schedule's upcoming days. Body (all optional):
 *   { dates: ["YYYY-MM-DD", ...], minute, timezone, maxAttempts, retryDelayMinutes, agentId }
 *
 * Every rule is enforced here, independently of the UI: today (from
 * midnight in the schedule's timezone) and past days are locked; days being
 * called, already attempted, or finished are never touched; a date that
 * became locked while the form was open rejects the whole edit (409).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const loaded = await loadSchedule(params);
  if (!loaded.ok) return loaded.response;
  const { supabase, user, patient, kind, tasks } = loaded;

  if (patient.doNotContact) {
    return NextResponse.json({ error: "This patient is marked Do Not Contact." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const edit: ScheduleEdit = {};
  if (body.dates !== undefined) {
    if (!Array.isArray(body.dates) || !body.dates.every((d) => typeof d === "string")) {
      return NextResponse.json({ error: "dates must be a list of YYYY-MM-DD strings." }, { status: 400 });
    }
    edit.dates = body.dates as string[];
  }
  for (const key of ["minute", "maxAttempts", "retryDelayMinutes"] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "number") return NextResponse.json({ error: `${key} must be a number.` }, { status: 400 });
      edit[key] = body[key] as number;
    }
  }
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string") return NextResponse.json({ error: "timezone must be a string." }, { status: 400 });
    edit.timezone = body.timezone;
  }
  if (body.agentId !== undefined) {
    if (typeof body.agentId !== "string" || !body.agentId) return NextResponse.json({ error: "Pick an agent." }, { status: 400 });
    // The agent must belong to this tenant.
    const tenantId = await getTenantIdForUser(supabase, user.id);
    const agent = tenantId ? await getAgentForTenant(supabase, body.agentId, tenantId) : null;
    if (!agent) return NextResponse.json({ error: "That agent wasn't found in your workspace." }, { status: 400 });
    edit.agentId = body.agentId;
  }

  const plan = planScheduleEdit({ kind, tasks }, edit, Date.now(), isValidTimeZone);
  if (!plan.ok) {
    return NextResponse.json({ error: plan.error, lockedDates: plan.lockedDates }, { status: plan.status });
  }

  const reference: FollowUpTaskRecord = tasks[tasks.length - 1];
  try {
    const result = await applyScheduleEdit(supabase, user.id, patient.id, plan, {
      rangeGroupId: reference.rangeGroupId,
      windowStartMinute: reference.windowStartMinute,
      windowEndMinute: reference.windowEndMinute,
      finalAction: reference.finalAction,
    });
    return NextResponse.json({
      ...result,
      message:
        result.skipped > 0
          ? `${result.skipped} day(s) weren't changed because they started calling or became locked while you were editing.`
          : null,
    });
  } catch (err) {
    if (err instanceof MigrationRequiredError) return NextResponse.json({ error: err.message }, { status: 503 });
    console.error("[schedules PATCH] failed:", err);
    return NextResponse.json({ error: "Failed to update the schedule." }, { status: 500 });
  }
}
