/**
 * Input checks for scheduling requests (single follow-ups, date ranges,
 * programmes). Kept separate from policy.ts, which decides retries and
 * calling windows for tasks that already exist.
 */

const MINUTES_PER_DAY = 24 * 60;

/** True if `timeZone` is an IANA zone this runtime understands. An unknown
 * zone makes Intl throw, which would crash retry scheduling later, so it's
 * rejected when the task is created instead. */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Validates a calling window from a request body. Returns an error message,
 * or null if the window is usable (including "no window"). A start later
 * than the end is allowed: that's an overnight window. */
export function validateCallingWindow(start: unknown, end: unknown): string | null {
  if (start == null && end == null) return null;
  if (start == null || end == null) return "Set both the start and end of the calling window, or neither.";
  const isMinute = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < MINUTES_PER_DAY;
  if (!isMinute(start) || !isMinute(end)) return "Calling window times must be minutes since midnight (0–1439).";
  if (start === end) return "The calling window's start and end can't be the same time.";
  return null;
}

/** The local calendar date ("2026-10-26") an instant falls on in `timeZone`. */
export function localDateKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
