/**
 * Pure slot-grid computation for a single provider/day — no DB access.
 * Used by both app/api/admin/appointments/availability/route.ts (staff-side
 * slot picker) and the check_appointment_availability agent tool
 * (lib/agent/tools.ts), so the two surfaces can never disagree about what
 * counts as "open".
 */

export interface TimeRange {
  /** "HH:MM" in the provider's working_hours shape (migration_v29.sql). */
  start: string;
  end: string;
}

export type WorkingHours = Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", [string, string][]>>;

export interface Slot {
  /** ISO 8601, UTC. */
  start: string;
  end: string;
  available: boolean;
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** No working_hours configured (null/undefined/empty) means "always
 * bookable" per migration_v29.sql's design — a default 9am-5pm window in
 * the given timezone, so a freshly-onboarded hospital isn't blocked from
 * booking before they've configured anything. */
const DEFAULT_WINDOW: [string, string][] = [["09:00", "17:00"]];

function parseHm(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Builds the list of candidate slot start/end instants (as UTC ISO
 * strings) for one calendar day in `timezone`, honoring the provider's
 * working_hours for that weekday (or the 9am-5pm default), then marks each
 * one unavailable if it overlaps any row in `existingRanges` (already-
 * fetched non-cancelled appointments for that provider/day). */
export function computeDaySlots(args: {
  dateKey: string; // "YYYY-MM-DD", interpreted in `timezone`
  timezone: string;
  slotMinutes: number;
  workingHours: WorkingHours | null | undefined;
  existingRanges: { startsAt: string; endsAt: string }[];
}): Slot[] {
  const { dateKey, timezone, slotMinutes, workingHours, existingRanges } = args;

  // Weekday of `dateKey` as seen in `timezone` (not the server's local
  // weekday, and not naively UTC — a date near midnight can fall on a
  // different calendar day in `timezone` than in UTC).
  const noonUtc = zonedDateTimeToUtc(dateKey, 12 * 60, timezone);
  const weekdayKey = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" })
    .format(new Date(noonUtc))
    .toLowerCase()
    .slice(0, 3) as (typeof WEEKDAY_KEYS)[number];
  const windows = (workingHours && workingHours[weekdayKey]) || DEFAULT_WINDOW;

  const existing = existingRanges.map((r) => ({ start: new Date(r.startsAt).getTime(), end: new Date(r.endsAt).getTime() }));

  const slots: Slot[] = [];
  for (const [winStart, winEnd] of windows) {
    const startMinute = parseHm(winStart);
    const endMinute = parseHm(winEnd);
    for (let m = startMinute; m + slotMinutes <= endMinute; m += slotMinutes) {
      const slotStart = zonedDateTimeToUtc(dateKey, m, timezone);
      const slotEnd = slotStart + slotMinutes * 60_000;
      const available = !existing.some((r) => slotStart < r.end && slotEnd > r.start);
      slots.push({ start: new Date(slotStart).toISOString(), end: new Date(slotEnd).toISOString(), available });
    }
  }
  return slots;
}

/** Resolves "YYYY-MM-DD" + minutes-since-midnight in `timezone` to a UTC
 * epoch-ms instant, using the Intl trick (format a UTC guess, read back the
 * offset, adjust) rather than a date library — same technique as
 * lib/scheduler/schedules.ts's zonedDateTimeToMs, duplicated here (not
 * imported) to keep this module dependency-free and usable from both the
 * API route and the agent tool handler without pulling in scheduler
 * internals. */
function zonedDateTimeToUtc(dateKey: string, minuteOfDay: number, timezone: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  const guessUtc = Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(guessUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtcIfLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = asUtcIfLocal - guessUtc;
  return guessUtc - offset;
}
