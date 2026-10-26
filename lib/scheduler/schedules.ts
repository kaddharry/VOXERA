/**
 * Follow-up "schedules": how a patient's individual follow_up_tasks rows
 * (one per day) are grouped, classified as current or past, and which of
 * their days may still be edited.
 *
 * Pure and database-free, so every rule here is unit-tested directly
 * (__tests__/scheduler/schedules.test.ts). The API routes apply exactly the
 * same functions server-side; the UI only displays their results.
 *
 * Grouping (no separate schedules table, see sql/migration_v23.sql):
 * - date-range schedules: every task sharing a "rangeGroupId"
 * - programme enrolments: every task from the same programme
 * - anything else: a single task is its own one-day schedule
 *
 * Day locking: a day is locked from 00:00 on that day in the schedule's
 * own timezone. Future days stay editable until 23:59:59 the day before.
 * All boundaries use the task's timezone, never the server's or browser's.
 */

import { localDateKey } from "./validation";

export type TaskStatus =
  | "scheduled"
  | "dispatching"
  | "calling"
  | "completed"
  | "exhausted"
  | "needs_review"
  | "cancelled"
  | "paused";

/** Statuses after which a day will never be called again. */
export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "exhausted", "needs_review", "cancelled"]);
/** A call is being placed or is in progress right now. Never touched by edits. */
export const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set(["dispatching", "calling"]);

export interface ScheduleTask {
  id: string;
  status: TaskStatus;
  nextAttemptAt: number;
  timezone: string;
  windowStartMinute: number | null;
  windowEndMinute: number | null;
  maxAttempts: number;
  attemptCount: number;
  retryDelayMinutes: number;
  agentId: string | null;
  lastOutcome: string | null;
  completedAt: number | null;
  cancelledAt: number | null;
  createdAt: number;
  rangeGroupId: string | null;
  programmeId?: string | null;
  programmeStepLabel?: string | null;
  /** migration_v23; null for rows the backfill couldn't fill. */
  scheduledDate?: string | null;
  scheduledMinute?: number | null;
  archivedAt?: number | null;
}

export type ScheduleKind = "range" | "programme" | "single";

/** Stable id for the schedule a task belongs to. Used in API URLs. */
export function scheduleIdOf(task: Pick<ScheduleTask, "id" | "rangeGroupId" | "programmeId">): string {
  if (task.rangeGroupId) return `range:${task.rangeGroupId}`;
  if (task.programmeId) return `programme:${task.programmeId}`;
  return `task:${task.id}`;
}

export function scheduleKindOf(scheduleId: string): ScheduleKind | null {
  if (scheduleId.startsWith("range:")) return "range";
  if (scheduleId.startsWith("programme:")) return "programme";
  if (scheduleId.startsWith("task:")) return "single";
  return null;
}

/** The planned calendar day of a task, in its own timezone. */
export function plannedDateOf(task: ScheduleTask): string {
  return task.scheduledDate || localDateKey(task.nextAttemptAt, task.timezone);
}

/** The planned call time of a task, minutes since local midnight. */
export function plannedMinuteOf(task: ScheduleTask): number {
  if (task.scheduledMinute != null) return task.scheduledMinute;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: task.timezone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(task.nextAttemptAt));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** Today's date in `timeZone`. */
export function todayIn(timeZone: string, now: number): string {
  return localDateKey(now, timeZone);
}

/** A day is locked from 00:00 on that day in `timeZone` onwards. */
export function isDateLocked(dateKey: string, timeZone: string, now: number): boolean {
  return dateKey <= todayIn(timeZone, now);
}

export type DayLockReason = "today" | "past" | "in_progress" | "already_attempted" | "finished" | null;

/**
 * Whether one day of a schedule may still be edited, and if not, why.
 * Editable means: its date is after today in its timezone, it isn't being
 * called right now, it hasn't been attempted yet, and it isn't finished.
 */
export function dayLock(task: ScheduleTask, now: number): DayLockReason {
  const date = plannedDateOf(task);
  const today = todayIn(task.timezone, now);
  if (date < today) return "past";
  if (date === today) return "today";
  if (ACTIVE_STATUSES.has(task.status)) return "in_progress";
  if (TERMINAL_STATUSES.has(task.status)) return "finished";
  if (task.attemptCount > 0) return "already_attempted";
  return null;
}

export type DayState =
  | "pending"
  | "retrying"
  | "calling"
  | "paused"
  | "completed"
  | "exhausted"
  | "needs_review"
  | "cancelled";

/** What actually happened (or is happening) on a day, for display. */
export function dayStateOf(task: ScheduleTask): DayState {
  switch (task.status) {
    case "dispatching":
    case "calling":
      return "calling";
    case "scheduled":
      return task.attemptCount > 0 ? "retrying" : "pending";
    default:
      return task.status;
  }
}

export interface ScheduleDay {
  taskId: string;
  date: string;
  minute: number;
  state: DayState;
  status: TaskStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  lastOutcome: string | null;
  completedAt: number | null;
  cancelledAt: number | null;
  /** null = editable */
  lock: DayLockReason;
  label: string | null;
}

/** The configuration a schedule's upcoming days use. */
export interface ScheduleConfig {
  timezone: string;
  /** One value when every day uses the same time; several when edits made them differ. */
  minutes: number[];
  maxAttempts: number;
  retryDelayMinutes: number;
  agentId: string | null;
  windowStartMinute: number | null;
  windowEndMinute: number | null;
}

export interface Schedule {
  id: string;
  kind: ScheduleKind;
  /** "current" while any day can still be (or is being) called; otherwise "past". */
  section: "current" | "past";
  startDate: string;
  endDate: string;
  config: ScheduleConfig;
  days: ScheduleDay[];
  counts: Record<DayState, number>;
  /** Days that "Edit schedule" may change. */
  editableDays: number;
  /** Why editing is unavailable, when editableDays is 0. */
  editBlockedReason: string | null;
  /** Whether "Clear past schedules" would include this schedule. */
  clearable: boolean;
  programmeId: string | null;
}

const EMPTY_COUNTS: Record<DayState, number> = {
  pending: 0,
  retrying: 0,
  calling: 0,
  paused: 0,
  completed: 0,
  exhausted: 0,
  needs_review: 0,
  cancelled: 0,
};

/**
 * Whether a finished schedule may be cleared (archived). Only schedules
 * where every day is finished, and none of whose non-cancelled days is
 * today or later in its timezone — so today's and future schedules, active
 * calls and pending retries can never be caught by a clear.
 */
export function isClearable(tasks: ScheduleTask[], now: number): boolean {
  if (tasks.length === 0) return false;
  return tasks.every((t) => {
    if (!TERMINAL_STATUSES.has(t.status)) return false;
    if (t.archivedAt) return false;
    if (t.status === "cancelled") return true;
    return plannedDateOf(t) < todayIn(t.timezone, now);
  });
}

/** Groups a patient's tasks into schedules, newest first within each section. Archived tasks are left out. */
export function groupSchedules(tasks: ScheduleTask[], now: number): Schedule[] {
  const groups = new Map<string, ScheduleTask[]>();
  for (const task of tasks) {
    if (task.archivedAt) continue;
    const id = scheduleIdOf(task);
    const list = groups.get(id);
    if (list) list.push(task);
    else groups.set(id, [task]);
  }

  const schedules: Schedule[] = [];
  for (const [id, groupTasks] of groups) {
    const sorted = [...groupTasks].sort(
      (a, b) => plannedDateOf(a).localeCompare(plannedDateOf(b)) || plannedMinuteOf(a) - plannedMinuteOf(b),
    );
    const days: ScheduleDay[] = sorted.map((t) => ({
      taskId: t.id,
      date: plannedDateOf(t),
      minute: plannedMinuteOf(t),
      state: dayStateOf(t),
      status: t.status,
      attemptCount: t.attemptCount,
      maxAttempts: t.maxAttempts,
      nextAttemptAt: t.nextAttemptAt,
      lastOutcome: t.lastOutcome,
      completedAt: t.completedAt,
      cancelledAt: t.cancelledAt,
      lock: dayLock(t, now),
      label: t.programmeStepLabel ?? null,
    }));

    const counts = { ...EMPTY_COUNTS };
    for (const d of days) counts[d.state]++;

    const isCurrent = sorted.some((t) => !TERMINAL_STATUSES.has(t.status));
    // Config of the schedule as it stands: taken from its not-yet-finished
    // days when there are any (edits only ever change those), otherwise
    // from its latest day.
    const upcoming = sorted.filter((t) => !TERMINAL_STATUSES.has(t.status));
    const configSource = upcoming.length > 0 ? upcoming : sorted.slice(-1);
    const latest = configSource[configSource.length - 1];
    const editableDays = days.filter((d) => d.lock === null).length;
    const kind = scheduleKindOf(id) ?? "single";

    let editBlockedReason: string | null = null;
    if (editableDays === 0) {
      editBlockedReason = !isCurrent
        ? "This schedule has finished. Past schedules are read-only."
        : "No upcoming days can be changed. Today's schedule is locked, and every other remaining day has already started or finished.";
    }

    schedules.push({
      id,
      kind,
      section: isCurrent ? "current" : "past",
      startDate: days[0].date,
      endDate: days[days.length - 1].date,
      config: {
        timezone: latest.timezone,
        minutes: [...new Set(configSource.map(plannedMinuteOf))].sort((a, b) => a - b),
        maxAttempts: latest.maxAttempts,
        retryDelayMinutes: latest.retryDelayMinutes,
        agentId: latest.agentId,
        windowStartMinute: latest.windowStartMinute,
        windowEndMinute: latest.windowEndMinute,
      },
      days,
      counts,
      editableDays,
      editBlockedReason,
      clearable: !isCurrent && isClearable(sorted, now),
      programmeId: sorted[0].programmeId ?? null,
    });
  }

  // Current first by start date (soonest first); past newest first.
  return schedules.sort((a, b) => {
    if (a.section !== b.section) return a.section === "current" ? -1 : 1;
    return a.section === "current" ? a.startDate.localeCompare(b.startDate) : b.endDate.localeCompare(a.endDate);
  });
}

/* ------------------------------------------------------------------ */
/* Editing                                                             */
/* ------------------------------------------------------------------ */

export interface ScheduleEdit {
  /** The complete set of upcoming dates the schedule should call on (YYYY-MM-DD). Range schedules only. */
  dates?: string[];
  /** New daily call time, minutes since local midnight. */
  minute?: number;
  timezone?: string;
  maxAttempts?: number;
  retryDelayMinutes?: number;
  agentId?: string | null;
}

export type EditPlan =
  | {
      ok: true;
      /** Existing editable days to update in place (the date is kept). */
      update: { taskId: string; date: string }[];
      /** Existing editable days no longer wanted: cancelled, never deleted. */
      cancel: string[];
      /** New dates: new task rows in the same schedule. */
      create: string[];
      /** Settings applied to every updated and created day. */
      settings: Required<Omit<ScheduleEdit, "dates">>;
    }
  | { ok: false; status: 400 | 409; error: string; lockedDates?: string[] };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(key: string): boolean {
  if (!DATE_KEY.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Works out exactly what an edit would change, re-checking every lock rule
 * against `now`. Nothing outside the schedule's editable days is ever in
 * the plan: today's, past, in-progress, already-attempted and finished
 * days are left exactly as they are. If a requested date has become locked
 * since the form was opened (e.g. the edit was submitted just after
 * midnight in the schedule's timezone), the whole edit is rejected so
 * nothing is half-applied.
 */
export function planScheduleEdit(
  schedule: { kind: ScheduleKind; tasks: ScheduleTask[] },
  edit: ScheduleEdit,
  now: number,
  isValidTimeZone: (tz: string) => boolean,
): EditPlan {
  const tasks = schedule.tasks.filter((t) => !t.archivedAt);
  if (tasks.length === 0) return { ok: false, status: 400, error: "Schedule not found." };

  const editable = tasks.filter((t) => dayLock(t, now) === null);
  const reference = editable[editable.length - 1] ?? tasks[tasks.length - 1];

  const oldTimezone = reference.timezone;
  const timezone = edit.timezone ?? oldTimezone;
  if (!isValidTimeZone(timezone)) return { ok: false, status: 400, error: `Unknown timezone "${timezone}".` };

  const minute = edit.minute ?? plannedMinuteOf(reference);
  if (!Number.isInteger(minute) || minute < 0 || minute >= 24 * 60) {
    return { ok: false, status: 400, error: "Call time must be between 00:00 and 23:59." };
  }
  const maxAttempts = edit.maxAttempts ?? reference.maxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    return { ok: false, status: 400, error: "Max attempts per day must be between 1 and 10." };
  }
  const retryDelayMinutes = edit.retryDelayMinutes ?? reference.retryDelayMinutes;
  if (!Number.isInteger(retryDelayMinutes) || retryDelayMinutes < 1 || retryDelayMinutes > 1440) {
    return { ok: false, status: 400, error: "Retry delay must be between 1 and 1440 minutes." };
  }
  const agentId = edit.agentId === undefined ? reference.agentId : edit.agentId;
  if (!agentId) return { ok: false, status: 400, error: "Pick an agent for this schedule." };

  if (edit.dates && schedule.kind !== "range") {
    return { ok: false, status: 400, error: "Only date-range schedules can add or remove days." };
  }

  // Days the user wants. For range schedules this is the submitted set;
  // otherwise the schedule's own editable days, unchanged.
  const wanted = edit.dates ? [...new Set(edit.dates)].sort() : editable.map(plannedDateOf);
  if (edit.dates) {
    const bad = wanted.filter((d) => !isRealDate(d));
    if (bad.length > 0) return { ok: false, status: 400, error: `Invalid date: ${bad.join(", ")}.` };
    if (wanted.length > 60) return { ok: false, status: 400, error: "A schedule can cover at most 60 days." };
  }

  // A wanted date must be after today in the schedule's current timezone
  // AND in the timezone it's being moved to — otherwise a timezone change
  // could turn a "tomorrow" into "today".
  const lockedDates = wanted.filter((d) => isDateLocked(d, oldTimezone, now) || isDateLocked(d, timezone, now));
  if (lockedDates.length > 0) {
    return {
      ok: false,
      status: 409,
      lockedDates,
      error: `These dates are locked and can't be changed: ${lockedDates.join(", ")}. Today is locked from midnight in the schedule's timezone (${oldTimezone}). Reload to see the latest schedule.`,
    };
  }

  // Wanted dates that collide with a day that exists but can't be edited
  // (e.g. a future day already being retried). Leave that day alone and
  // refuse to create a second call on the same date.
  const lockedExisting = new Map(
    tasks.filter((t) => dayLock(t, now) !== null && t.status !== "cancelled").map((t) => [plannedDateOf(t), t]),
  );
  const collisions = wanted.filter((d) => lockedExisting.has(d));
  if (collisions.length > 0) {
    return {
      ok: false,
      status: 409,
      lockedDates: collisions,
      error: `These dates already have a call in progress or attempted and can't be changed: ${collisions.join(", ")}.`,
    };
  }

  const editableByDate = new Map(editable.map((t) => [plannedDateOf(t), t]));
  const update = wanted.filter((d) => editableByDate.has(d)).map((d) => ({ taskId: editableByDate.get(d)!.id, date: d }));
  const cancel = editable.filter((t) => !wanted.includes(plannedDateOf(t))).map((t) => t.id);
  const create = wanted.filter((d) => !editableByDate.has(d));

  if (update.length + create.length === 0 && cancel.length === 0) {
    return { ok: false, status: 400, error: "Nothing to change: this schedule has no upcoming days that can be edited." };
  }

  return { ok: true, update, cancel, create, settings: { minute, timezone, maxAttempts, retryDelayMinutes, agentId } };
}

/* ------------------------------------------------------------------ */
/* Time helpers                                                        */
/* ------------------------------------------------------------------ */

function offsetMinutes(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - ms) / 60_000;
}

/** The instant a local wall-clock time occurs on `dateKey` in `timeZone` (DST-aware). */
export function zonedDateTimeToMs(dateKey: string, minuteOfDay: number, timeZone: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  let ms = wallAsUtc - offsetMinutes(wallAsUtc, timeZone) * 60_000;
  // Re-check with the offset at the result itself (differs across a DST change).
  ms = wallAsUtc - offsetMinutes(ms, timeZone) * 60_000;
  return ms;
}
