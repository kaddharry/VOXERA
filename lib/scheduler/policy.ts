/**
 * Pure retry/window decision logic for the follow-up scheduler
 * (migration_v18.sql). Kept dependency-free and side-effect-free so it's
 * directly unit-testable (see __tests__/scheduler/policy.test.ts) — the
 * stateful part (claiming/dispatching/persisting) lives in dispatcher.ts.
 */

export type TwilioCallStatus = "completed" | "busy" | "no-answer" | "failed" | "canceled";

/** Provider-level outcomes where the call never actually connected — always
 * retryable up to maxAttempts. A "completed" call (one that connected) is
 * handled separately via the post-call summary's followUpOutcome, since a
 * connected call's actual result can't be known from Twilio's status alone
 * — spec §10.4 explicitly warns against treating every hang-up/end as
 * automatically retryable. */
const RETRYABLE_TWILIO_STATUSES: ReadonlySet<TwilioCallStatus> = new Set(["busy", "no-answer", "failed", "canceled"]);

export interface RetryDecisionInput {
  twilioStatus: TwilioCallStatus;
  /** Set only once the post-call LLM summary has run (app/api/telephony/
   * status/route.ts chains the decision onto that, not the raw webhook) —
   * undefined for a call that never connected. */
  followUpOutcome?: "resolved" | "needs_retry" | "needs_review";
  attemptCount: number;
  maxAttempts: number;
}

export type RetryDecision =
  | { action: "retry" }
  | { action: "completed" }
  | { action: "needs_review"; reason: string }
  | { action: "exhausted" };

/** maxAttempts INCLUDES the initial attempt (migration_v18.sql's doc
 * comment) — attemptCount is incremented at dispatch time, so by the time
 * this runs for the Nth attempt, attemptCount already equals N. */
export function decideNextStep(input: RetryDecisionInput): RetryDecision {
  const attemptsRemain = input.attemptCount < input.maxAttempts;

  if (!RETRYABLE_TWILIO_STATUSES.has(input.twilioStatus)) {
    // Call connected. Never infer completion from "the call ended" alone.
    switch (input.followUpOutcome) {
      case "resolved":
        return { action: "completed" };
      case "needs_retry":
        return attemptsRemain ? { action: "retry" } : { action: "exhausted" };
      case "needs_review":
      case undefined:
      default:
        // No clear signal (summary failed/missing, or the model couldn't
        // tell) — conservative default is a human review, not a silent
        // "completed", per spec §8.2's "connected ≠ completed" rule.
        return { action: "needs_review", reason: "Call connected but the outcome could not be confirmed automatically." };
    }
  }

  // Never connected — a provider-level failure, always retryable.
  return attemptsRemain ? { action: "retry" } : { action: "exhausted" };
}

export interface CallingWindow {
  /** Minutes since local midnight, e.g. 600 = 10:00. Both undefined means
   * no window restriction. A start later than the end is an overnight
   * window (e.g. 20:00–02:00). */
  windowStartMinute?: number | null;
  windowEndMinute?: number | null;
  timezone: string;
}

function isInsideWindow(minute: number, start: number, end: number): boolean {
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/**
 * Given a candidate instant and a local calling window, returns the actual
 * instant to dispatch at: unchanged if already inside the window, otherwise
 * the next time the window opens — never backward. Spec §10.3: "If the
 * delay lands outside the window, move it to the next allowed time."
 *
 * Handles overnight windows (start > end, e.g. 20:00–02:00), and computes
 * "tomorrow" from the local calendar rather than adding 24h, so the result
 * stays on the window start across DST changes.
 */
export function resolveWithinWindow(candidateMs: number, window: CallingWindow): number {
  const { windowStartMinute: start, windowEndMinute: end, timezone } = window;
  if (start == null || end == null || start === end) return candidateMs;

  const minutesInDay = getLocalMinuteOfDay(candidateMs, timezone);
  if (isInsideWindow(minutesInDay, start, end)) return candidateMs;

  // Outside the window. For a same-day window (start < end) that's either
  // before today's opening or after today's close; for an overnight window
  // it can only be the daytime gap before tonight's opening.
  const opensToday = minutesInDay < start;
  const dayStartMs = getLocalMidnightMs(candidateMs, timezone);
  const targetDayStartMs = opensToday
    ? dayStartMs
    : // Midnight of the next local calendar day. +36h always lands inside
      // tomorrow, even on a 23h or 25h DST day.
      getLocalMidnightMs(dayStartMs + 36 * 60 * 60_000, timezone);
  return localTimeToMs(targetDayStartMs, start, timezone);
}

/** The instant a local wall-clock time (minutes since midnight) occurs on
 * the local day starting at `dayStartMs`, correcting for a DST change
 * between midnight and that time. */
function localTimeToMs(dayStartMs: number, minuteOfDay: number, timeZone: string): number {
  const guess = dayStartMs + minuteOfDay * 60_000;
  const drift = getTimezoneOffsetMinutes(guess, timeZone) - getTimezoneOffsetMinutes(dayStartMs, timeZone);
  return guess - drift * 60_000;
}

function getLocalMinuteOfDay(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Local midnight for the given instant's calendar date, as a UTC ms
 * instant — correct across DST transitions because it's derived from the
 * timezone's own rendered Y/M/D rather than a fixed 24h offset. */
function getLocalMidnightMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  // Date.UTC gives us a stable instant for that Y/M/D at 00:00 UTC, then we
  // correct for the timezone's actual offset at that instant.
  const utcGuess = Date.UTC(year, month - 1, day);
  const offsetMinutes = getTimezoneOffsetMinutes(utcGuess, timeZone);
  return utcGuess - offsetMinutes * 60_000;
}

function getTimezoneOffsetMinutes(ms: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUTC - ms) / 60_000;
}
