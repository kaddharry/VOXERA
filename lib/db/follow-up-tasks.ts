import type { SupabaseClient } from "@supabase/supabase-js";
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
}

const TASK_COLUMNS =
  'id, "clientId", "patientId", "agentId", status, "nextAttemptAt", timezone, "windowStartMinute", ' +
  '"windowEndMinute", "maxAttempts", "attemptCount", "retryDelayMinutes", "finalAction", "lastOutcome", ' +
  '"pausedAt", "cancelledAt", "completedAt", "createdAt", "claimedAt", "claimedBy", "rangeGroupId"';

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
  const { data, error } = await db
    .from("follow_up_tasks")
    .select(TASK_COLUMNS)
    .eq("clientId", clientId)
    .order("nextAttemptAt", { ascending: true });
  if (error || !data) return [];
  return data as unknown as FollowUpTaskRecord[];
}

export async function listFollowUpTasksForPatient(
  db: SupabaseClient,
  patientId: string,
  clientId: string,
): Promise<FollowUpTaskRecord[]> {
  const { data, error } = await db
    .from("follow_up_tasks")
    .select(TASK_COLUMNS)
    .eq("patientId", patientId)
    .eq("clientId", clientId)
    .order("nextAttemptAt", { ascending: true });
  if (error || !data) return [];
  return data as unknown as FollowUpTaskRecord[];
}

export async function createFollowUpTask(
  db: SupabaseClient,
  clientId: string,
  fields: CreateFollowUpFields,
): Promise<FollowUpTaskRecord | null> {
  const { data, error } = await db
    .from("follow_up_tasks")
    .insert({
      id: nanoid(12),
      clientId,
      patientId: fields.patientId,
      agentId: fields.agentId ?? null,
      status: "scheduled",
      nextAttemptAt: fields.scheduledAt,
      timezone: fields.timezone ?? "UTC",
      windowStartMinute: fields.windowStartMinute ?? null,
      windowEndMinute: fields.windowEndMinute ?? null,
      maxAttempts: fields.maxAttempts ?? 3,
      attemptCount: 0,
      retryDelayMinutes: fields.retryDelayMinutes ?? 30,
      finalAction: fields.finalAction ?? "needs_review",
      rangeGroupId: fields.rangeGroupId ?? null,
      createdAt: Date.now(),
    })
    .select(TASK_COLUMNS)
    .single();
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
  const rows = fields.dailyAttemptTimes.map((scheduledAt) => ({
    id: nanoid(12),
    clientId,
    patientId: fields.patientId,
    agentId: fields.agentId ?? null,
    status: "scheduled" as const,
    nextAttemptAt: scheduledAt,
    timezone: fields.timezone ?? "UTC",
    windowStartMinute: fields.windowStartMinute ?? null,
    windowEndMinute: fields.windowEndMinute ?? null,
    maxAttempts: fields.maxAttemptsPerDay ?? 3,
    attemptCount: 0,
    retryDelayMinutes: fields.retryDelayMinutes ?? 30,
    finalAction: fields.finalAction ?? "needs_review",
    rangeGroupId,
    createdAt: Date.now(),
  }));
  const { data, error } = await db.from("follow_up_tasks").insert(rows).select(TASK_COLUMNS);
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
  const updates: Record<string, unknown> =
    action === "pause"
      ? { status: "paused", pausedAt: Date.now() }
      : action === "cancel"
        ? { status: "cancelled", cancelledAt: Date.now() }
        : { status: "scheduled", pausedAt: null, nextAttemptAt: resumeAt ?? Date.now() };

  const { data, error } = await db
    .from("follow_up_tasks")
    .update(updates)
    .eq("id", taskId)
    .eq("clientId", clientId)
    .in("status", action === "resume" ? ["paused"] : ["scheduled", "paused"])
    .select(TASK_COLUMNS)
    .single();
  if (error || !data) return null;
  return data as unknown as FollowUpTaskRecord;
}
