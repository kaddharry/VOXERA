import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWithinWindow } from "../scheduler/policy";
import { localDateKey } from "../scheduler/validation";
import { TERMINAL_STATUSES, zonedDateTimeToMs, type EditPlan } from "../scheduler/schedules";
import { nanoid } from "nanoid";

/**
 * Shared DB access for follow_up_tasks (migration_v18.sql). Scoped by
 * "clientId", same convention as patients/call_logs — see lib/db/patients.ts.
 */

export type FollowUpStatus =
  | "scheduled"
  | "dispatching"
  | "calling"
  | "completed"
  | "exhausted"
  | "needs_review"
  | "cancelled"
  | "paused";

export interface FollowUpTaskRecord {
  id: string;
  clientId: string;
  patientId: string;
  agentId: string | null;
  status: FollowUpStatus;
  nextAttemptAt: number;
  timezone: string;
  windowStartMinute: number | null;
  windowEndMinute: number | null;
  maxAttempts: number;
  attemptCount: number;
  retryDelayMinutes: number;
  finalAction: "needs_review" | "completed" | "cancelled";
  lastOutcome: string | null;
  pausedAt: number | null;
  cancelledAt: number | null;
  completedAt: number | null;
  createdAt: number;
  claimedAt: number | null;
  claimedBy: string | null;
  /** Shared by every task a single "call daily from date A to date B"
   * schedule created (see createFollowUpRange below) — null for a plain
   * single-call or programme-template schedule. */
  rangeGroupId: string | null;
  /** migration_v19 — set for tasks created by enrolling in a programme. */
  programmeId?: string | null;
  programmeStepLabel?: string | null;
  /** migration_v23 — planned day ('YYYY-MM-DD') and time (minutes since
   * midnight) in `timezone`, never changed by retries; and when the task
   * was hidden by "Clear past schedules". Absent until v23 is applied. */
  scheduledDate?: string | null;
  scheduledMinute?: number | null;
  archivedAt?: number | null;
}

const BASE_TASK_COLUMNS =
  'id, "clientId", "patientId", "agentId", status, "nextAttemptAt", timezone, "windowStartMinute", ' +
  '"windowEndMinute", "maxAttempts", "attemptCount", "retryDelayMinutes", "finalAction", "lastOutcome", ' +
  '"pausedAt", "cancelledAt", "completedAt", "createdAt", "claimedAt", "claimedBy", "rangeGroupId", ' +
  '"programmeId", "programmeStepLabel"';
const TASK_COLUMNS = BASE_TASK_COLUMNS + ', "scheduledDate", "scheduledMinute", "archivedAt"';
const V23_FIELDS = ["scheduledDate", "scheduledMinute", "archivedAt"] as const;

/**
 * True when Postgres/PostgREST rejected a query because a column doesn't
 * exist — i.e. migration_v23.sql hasn't been run on this database yet.
 * Every query that touches the v23 columns falls back to the pre-v23 shape
 * when this happens, so deploying this code before running the migration
 * never breaks scheduling; only the new schedule edit/clear features need it.
 */
export function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(error.message ?? "");
}

function withoutV23Fields<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row };
  for (const f of V23_FIELDS) delete copy[f];
  return copy;
}

/** Planned day/time of a task as it will first be called, for the v23 columns. */
function plannedFields(nextAttemptAt: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(
    new Date(nextAttemptAt),
  );
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { scheduledDate: localDateKey(nextAttemptAt, timezone), scheduledMinute: get("hour") * 60 + get("minute") };
}

/** Inserts rows, retrying without the v23 columns if the migration hasn't run yet. */
async function insertTasks(db: SupabaseClient, rows: Record<string, unknown>[]) {
  const first = await db.from("follow_up_tasks").insert(rows).select(TASK_COLUMNS);
  if (!isMissingColumnError(first.error)) return first;
  return db.from("follow_up_tasks").insert(rows.map(withoutV23Fields)).select(BASE_TASK_COLUMNS);
}

export interface CreateFollowUpFields {
  patientId: string;
  agentId?: string | null;
  scheduledAt: number;
  timezone?: string;
  windowStartMinute?: number | null;
  windowEndMinute?: number | null;
  maxAttempts?: number;
  retryDelayMinutes?: number;
  finalAction?: "needs_review" | "completed" | "cancelled";
  rangeGroupId?: string | null;
}

export async function listFollowUpTasks(db: SupabaseClient, clientId: string): Promise<FollowUpTaskRecord[]> {
  const query = (columns: string) =>
    db.from("follow_up_tasks").select(columns).eq("clientId", clientId).order("nextAttemptAt", { ascending: true });
  let { data, error } = await query(TASK_COLUMNS);
  if (isMissingColumnError(error)) ({ data, error } = await query(BASE_TASK_COLUMNS));
  if (error || !data) return [];
  return data as unknown as FollowUpTaskRecord[];
}

export async function listFollowUpTasksForPatient(
  db: SupabaseClient,
  patientId: string,
  clientId: string,
): Promise<FollowUpTaskRecord[]> {
  // Tasks hidden by "Clear past schedules" (archivedAt set) are left out.
  let { data, error } = await db
    .from("follow_up_tasks")
    .select(TASK_COLUMNS)
    .eq("patientId", patientId)
    .eq("clientId", clientId)
    .is("archivedAt", null)
    .order("nextAttemptAt", { ascending: true });
  if (isMissingColumnError(error)) {
    ({ data, error } = await db
      .from("follow_up_tasks")
      .select(BASE_TASK_COLUMNS)
      .eq("patientId", patientId)
      .eq("clientId", clientId)
      .order("nextAttemptAt", { ascending: true }));
  }
  if (error || !data) return [];
  return data as unknown as FollowUpTaskRecord[];
}

export async function createFollowUpTask(
  db: SupabaseClient,
  clientId: string,
  fields: CreateFollowUpFields,
): Promise<FollowUpTaskRecord | null> {
  const timezone = fields.timezone ?? "UTC";
  // The first attempt obeys the calling window too, not just retries —
  // otherwise a call scheduled for 11pm with a 10:00–18:00 window went
  // out at 11pm.
  const nextAttemptAt = resolveWithinWindow(fields.scheduledAt, {
    windowStartMinute: fields.windowStartMinute,
    windowEndMinute: fields.windowEndMinute,
    timezone,
  });
  const { data: rows, error } = await insertTasks(db, [
    {
      id: nanoid(12),
      clientId,
      patientId: fields.patientId,
      agentId: fields.agentId ?? null,
      status: "scheduled",
      nextAttemptAt,
      ...plannedFields(nextAttemptAt, timezone),
      timezone,
      windowStartMinute: fields.windowStartMinute ?? null,
      windowEndMinute: fields.windowEndMinute ?? null,
      maxAttempts: fields.maxAttempts ?? 3,
      attemptCount: 0,
      retryDelayMinutes: fields.retryDelayMinutes ?? 30,
      finalAction: fields.finalAction ?? "needs_review",
      rangeGroupId: fields.rangeGroupId ?? null,
      createdAt: Date.now(),
    },
  ]);
  const data = rows?.[0];
  if (error || !data) {
    console.error("[lib/db/follow-up-tasks] createFollowUpTask failed:", error?.message);
    return null;
  }
  return data as unknown as FollowUpTaskRecord;
}

/**
 * Creates one follow_up_tasks row per day in a date range, all sharing a
 * fresh rangeGroupId — the backing for "call this patient daily from date A
 * to date B at roughly this time." Each day is its own independent task
 * with its own retry budget, which is what already makes "stop calling for
 * today once they've picked up and talked" work for free: a connected,
 * resolved call marks *that day's* task completed (see
 * lib/scheduler/dispatcher.ts's handleFollowUpCallOutcome), which simply
 * means there's no more same-day task left to retry — it never touches the
 * other days' independently-scheduled tasks.
 */
export async function createFollowUpRange(
  db: SupabaseClient,
  clientId: string,
  fields: {
    patientId: string;
    agentId?: string | null;
    dailyAttemptTimes: number[]; // one unix-ms "first attempt today" instant per day, already resolved client-side
    timezone?: string;
    windowStartMinute?: number | null;
    windowEndMinute?: number | null;
    maxAttemptsPerDay?: number;
    retryDelayMinutes?: number;
    finalAction?: "needs_review" | "completed" | "cancelled";
  },
): Promise<FollowUpTaskRecord[]> {
  const rangeGroupId = `range_${nanoid(10)}`;
  const timezone = fields.timezone ?? "UTC";
  const rows = fields.dailyAttemptTimes.map((scheduledAt) => {
    const nextAttemptAt = resolveWithinWindow(scheduledAt, {
      windowStartMinute: fields.windowStartMinute,
      windowEndMinute: fields.windowEndMinute,
      timezone,
    });
    return {
      id: nanoid(12),
      clientId,
      patientId: fields.patientId,
      agentId: fields.agentId ?? null,
      status: "scheduled" as const,
      nextAttemptAt,
      ...plannedFields(nextAttemptAt, timezone),
      timezone,
      windowStartMinute: fields.windowStartMinute ?? null,
      windowEndMinute: fields.windowEndMinute ?? null,
      maxAttempts: fields.maxAttemptsPerDay ?? 3,
      attemptCount: 0,
      retryDelayMinutes: fields.retryDelayMinutes ?? 30,
      finalAction: fields.finalAction ?? "needs_review",
      rangeGroupId,
      createdAt: Date.now(),
    };
  });
  const { data, error } = await insertTasks(db, rows);
  if (error || !data) {
    console.error("[lib/db/follow-up-tasks] createFollowUpRange failed:", error?.message);
    return [];
  }
  return data as unknown as FollowUpTaskRecord[];
}

/** Only "scheduled" or "paused" tasks can be paused/resumed/cancelled from
 * the UI — a task currently "dispatching"/"calling" is mid-flight and must
 * not be touched here (the dispatcher owns that transition). */
export async function setFollowUpTaskStatus(
  db: SupabaseClient,
  taskId: string,
  clientId: string,
  action: "pause" | "resume" | "cancel",
  resumeAt?: number,
): Promise<FollowUpTaskRecord | null> {
  let updates: Record<string, unknown>;
  if (action === "pause") {
    updates = { status: "paused", pausedAt: Date.now() };
  } else if (action === "cancel") {
    updates = { status: "cancelled", cancelledAt: Date.now() };
  } else {
    // Resuming re-applies the task's own calling window, so "resume now"
    // at night waits for the window instead of calling immediately.
    const { data: current } = await db
      .from("follow_up_tasks")
      .select('timezone, "windowStartMinute", "windowEndMinute"')
      .eq("id", taskId)
      .eq("clientId", clientId)
      .maybeSingle();
    const candidate = Math.max(resumeAt ?? Date.now(), Date.now());
    const nextAttemptAt = current
      ? resolveWithinWindow(candidate, {
          windowStartMinute: current.windowStartMinute,
          windowEndMinute: current.windowEndMinute,
          timezone: current.timezone,
        })
      : candidate;
    updates = { status: "scheduled", pausedAt: null, nextAttemptAt };
  }

  const { data, error } = await db
    .from("follow_up_tasks")
    .update(updates)
    .eq("id", taskId)
    .eq("clientId", clientId)
    .in("status", action === "resume" ? ["paused"] : ["scheduled", "paused"])
    .select(BASE_TASK_COLUMNS)
    .single();
  if (error || !data) return null;
  return data as unknown as FollowUpTaskRecord;
}

/* ------------------------------------------------------------------ */
/* Schedules (lib/scheduler/schedules.ts) — need migration_v23.sql     */
/* ------------------------------------------------------------------ */

export class MigrationRequiredError extends Error {
  constructor() {
    super("This feature needs database migration v23 (sql/migration_v23.sql). Ask an admin to run it.");
  }
}

/**
 * Applies a plan from planScheduleEdit(). Every write is scoped to this
 * tenant and patient, and only matches a day that is still untouched
 * ("scheduled"/"paused", never attempted, same planned date) — so a day
 * that started calling or became locked between planning and writing is
 * left alone instead of being changed. Days the user removed are
 * cancelled, never deleted. Returns how many days could not be changed.
 */
export async function applyScheduleEdit(
  db: SupabaseClient,
  clientId: string,
  patientId: string,
  plan: Extract<EditPlan, { ok: true }>,
  context: { rangeGroupId: string | null; windowStartMinute: number | null; windowEndMinute: number | null; finalAction: string },
): Promise<{ updated: number; cancelled: number; created: number; skipped: number }> {
  const { minute, timezone, maxAttempts, retryDelayMinutes, agentId } = plan.settings;
  const window = { windowStartMinute: context.windowStartMinute, windowEndMinute: context.windowEndMinute, timezone };
  const firstAttemptFor = (date: string) => resolveWithinWindow(zonedDateTimeToMs(date, minute, timezone), window);
  // Every write below only matches a day that's still untouched: this
  // tenant and patient, not started, never attempted.
  const UNTOUCHED_STATUSES = ["scheduled", "paused"];

  let updated = 0;
  let skipped = 0;
  for (const { taskId, date } of plan.update) {
    const { data, error } = await db
      .from("follow_up_tasks")
      .update({
        nextAttemptAt: firstAttemptFor(date),
        scheduledDate: date,
        scheduledMinute: minute,
        timezone,
        maxAttempts,
        retryDelayMinutes,
        agentId,
      })
      .eq("id", taskId)
      .eq("clientId", clientId)
      .eq("patientId", patientId)
      .in("status", UNTOUCHED_STATUSES)
      .eq("attemptCount", 0)
      .eq("scheduledDate", date)
      .select("id");
    if (isMissingColumnError(error)) throw new MigrationRequiredError();
    if (data?.length) updated++;
    else skipped++;
  }

  let cancelled = 0;
  if (plan.cancel.length > 0) {
    const { data, error } = await db
      .from("follow_up_tasks")
      .update({ status: "cancelled", cancelledAt: Date.now(), lastOutcome: "removed_from_schedule" })
      .in("id", plan.cancel)
      .eq("clientId", clientId)
      .eq("patientId", patientId)
      .in("status", UNTOUCHED_STATUSES)
      .eq("attemptCount", 0)
      .select("id");
    if (isMissingColumnError(error)) throw new MigrationRequiredError();
    cancelled = data?.length ?? 0;
    skipped += plan.cancel.length - cancelled;
  }

  let created = 0;
  if (plan.create.length > 0) {
    const rows = plan.create.map((date) => ({
      id: nanoid(12),
      clientId,
      patientId,
      agentId,
      status: "scheduled",
      nextAttemptAt: firstAttemptFor(date),
      scheduledDate: date,
      scheduledMinute: minute,
      timezone,
      windowStartMinute: context.windowStartMinute,
      windowEndMinute: context.windowEndMinute,
      maxAttempts,
      attemptCount: 0,
      retryDelayMinutes,
      finalAction: context.finalAction,
      rangeGroupId: context.rangeGroupId,
      createdAt: Date.now(),
    }));
    const { data, error } = await db.from("follow_up_tasks").insert(rows).select("id");
    if (isMissingColumnError(error)) throw new MigrationRequiredError();
    if (error) console.error("[lib/db/follow-up-tasks] applyScheduleEdit insert failed:", error.message);
    created = data?.length ?? 0;
  }

  return { updated, cancelled, created, skipped };
}

/**
 * Hides finished tasks from the Follow-ups panel ("Clear past schedules")
 * by setting archivedAt. Nothing is deleted. The caller picks the task ids
 * server-side (isClearable); this re-checks, in the same statement, that
 * each one belongs to this tenant and patient and is finished, so an
 * active or future task can never be archived even if it were passed in.
 */
export async function archiveFinishedTasks(db: SupabaseClient, clientId: string, patientId: string, taskIds: string[]): Promise<number> {
  if (taskIds.length === 0) return 0;
  const { data, error } = await db
    .from("follow_up_tasks")
    .update({ archivedAt: Date.now() })
    .in("id", taskIds)
    .eq("clientId", clientId)
    .eq("patientId", patientId)
    .in("status", [...TERMINAL_STATUSES])
    .is("archivedAt", null)
    .select("id");
  if (isMissingColumnError(error)) throw new MigrationRequiredError();
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}
