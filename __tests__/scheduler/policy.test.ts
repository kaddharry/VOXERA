import { describe, it, expect } from "vitest";
import { decideNextStep, resolveWithinWindow } from "../../lib/scheduler/policy";

describe("decideNextStep", () => {
  it("retries a provider-level failure (no-answer) while attempts remain", () => {
    const decision = decideNextStep({ twilioStatus: "no-answer", attemptCount: 1, maxAttempts: 3 });
    expect(decision).toEqual({ action: "retry" });
  });

  it("exhausts a provider-level failure once max attempts are used", () => {
    const decision = decideNextStep({ twilioStatus: "busy", attemptCount: 3, maxAttempts: 3 });
    expect(decision).toEqual({ action: "exhausted" });
  });

  it("treats every retryable Twilio status the same way", () => {
    for (const status of ["busy", "no-answer", "failed", "canceled"] as const) {
      expect(decideNextStep({ twilioStatus: status, attemptCount: 0, maxAttempts: 3 })).toEqual({ action: "retry" });
    }
  });

  it("marks a connected call completed only when the summary says resolved", () => {
    const decision = decideNextStep({
      twilioStatus: "completed",
      followUpOutcome: "resolved",
      attemptCount: 1,
      maxAttempts: 3,
    });
    expect(decision).toEqual({ action: "completed" });
  });

  it("retries a connected-but-inconclusive call while attempts remain", () => {
    const decision = decideNextStep({
      twilioStatus: "completed",
      followUpOutcome: "needs_retry",
      attemptCount: 1,
      maxAttempts: 3,
    });
    expect(decision).toEqual({ action: "retry" });
  });

  it("exhausts a connected-but-inconclusive call once attempts run out, rather than retrying forever", () => {
    const decision = decideNextStep({
      twilioStatus: "completed",
      followUpOutcome: "needs_retry",
      attemptCount: 3,
      maxAttempts: 3,
    });
    expect(decision).toEqual({ action: "exhausted" });
  });

  it("never silently marks a connected call completed when the outcome is unknown — defaults to needs_review", () => {
    const decision = decideNextStep({ twilioStatus: "completed", attemptCount: 1, maxAttempts: 3 });
    expect(decision.action).toBe("needs_review");
  });

  it("sends an explicit needs_review summary verdict to needs_review, not completed", () => {
    const decision = decideNextStep({
      twilioStatus: "completed",
      followUpOutcome: "needs_review",
      attemptCount: 1,
      maxAttempts: 3,
    });
    expect(decision.action).toBe("needs_review");
  });
});

describe("resolveWithinWindow", () => {
  const TZ = "America/New_York";

  it("leaves a candidate instant untouched when it already falls inside the window", () => {
    // 2024-06-15 is EDT (UTC-4). 14:30 local = 18:30 UTC.
    const candidate = Date.UTC(2024, 5, 15, 18, 30);
    const resolved = resolveWithinWindow(candidate, { windowStartMinute: 9 * 60, windowEndMinute: 18 * 60, timezone: TZ });
    expect(resolved).toBe(candidate);
  });

  it("pushes a too-early candidate forward to the same day's window start", () => {
    // 06:00 local (10:00 UTC) — before the 9am window start.
    const candidate = Date.UTC(2024, 5, 15, 10, 0);
    const resolved = resolveWithinWindow(candidate, { windowStartMinute: 9 * 60, windowEndMinute: 18 * 60, timezone: TZ });
    // Expect 09:00 EDT the same day == 13:00 UTC.
    expect(new Date(resolved).toISOString()).toBe(new Date(Date.UTC(2024, 5, 15, 13, 0)).toISOString());
  });

  it("pushes a too-late candidate to the NEXT day's window start, not backward", () => {
    // 20:00 local (00:00 UTC next day) — after the 6pm window end.
    const candidate = Date.UTC(2024, 5, 16, 0, 0); // 2024-06-15 20:00 EDT
    const resolved = resolveWithinWindow(candidate, { windowStartMinute: 9 * 60, windowEndMinute: 18 * 60, timezone: TZ });
    // Expect 09:00 EDT the NEXT day == 2024-06-16 13:00 UTC.
    expect(new Date(resolved).toISOString()).toBe(new Date(Date.UTC(2024, 5, 16, 13, 0)).toISOString());
    expect(resolved).toBeGreaterThan(candidate);
  });

  it("is a no-op when no window is configured", () => {
    const candidate = Date.now();
    expect(resolveWithinWindow(candidate, { timezone: TZ })).toBe(candidate);
  });
});

describe("resolveWithinWindow — overnight windows and DST", () => {
  const TZ = "America/New_York";
  const overnight = { windowStartMinute: 20 * 60, windowEndMinute: 2 * 60, timezone: TZ }; // 20:00–02:00

  it("treats late evening as inside an overnight window", () => {
    const candidate = Date.UTC(2024, 5, 16, 1, 0); // 2024-06-15 21:00 EDT
    expect(resolveWithinWindow(candidate, overnight)).toBe(candidate);
  });

  it("treats just after midnight as inside an overnight window", () => {
    const candidate = Date.UTC(2024, 5, 16, 5, 0); // 2024-06-16 01:00 EDT
    expect(resolveWithinWindow(candidate, overnight)).toBe(candidate);
  });

  it("moves a daytime candidate to that evening's opening, not the next day", () => {
    const candidate = Date.UTC(2024, 5, 15, 16, 0); // 2024-06-15 12:00 EDT
    const resolved = resolveWithinWindow(candidate, overnight);
    expect(new Date(resolved).toISOString()).toBe(new Date(Date.UTC(2024, 5, 16, 0, 0)).toISOString()); // 20:00 EDT
  });

  it("lands on the window start the day after DST begins (23-hour day)", () => {
    // 2024-03-09 19:00 EST, after an 09:00–18:00 window. DST starts 2024-03-10.
    const candidate = Date.UTC(2024, 2, 10, 0, 0);
    const resolved = resolveWithinWindow(candidate, { windowStartMinute: 9 * 60, windowEndMinute: 18 * 60, timezone: TZ });
    // 2024-03-10 09:00 EDT == 13:00 UTC (a fixed +24h would give 10:00 EDT).
    expect(new Date(resolved).toISOString()).toBe(new Date(Date.UTC(2024, 2, 10, 13, 0)).toISOString());
  });

  it("lands on the window start the day after DST ends (25-hour day)", () => {
    // 2024-11-02 19:00 EDT, after the window. DST ends 2024-11-03.
    const candidate = Date.UTC(2024, 10, 2, 23, 0);
    const resolved = resolveWithinWindow(candidate, { windowStartMinute: 9 * 60, windowEndMinute: 18 * 60, timezone: TZ });
    // 2024-11-03 09:00 EST == 14:00 UTC (a fixed +24h would give 08:00 EST).
    expect(new Date(resolved).toISOString()).toBe(new Date(Date.UTC(2024, 10, 3, 14, 0)).toISOString());
  });

  it("works for a timezone with no DST (Asia/Kolkata)", () => {
    // 2026-10-26 23:00 IST (17:30 UTC), after a 10:00–18:00 window.
    const candidate = Date.UTC(2026, 9, 26, 17, 30);
    const resolved = resolveWithinWindow(candidate, { windowStartMinute: 10 * 60, windowEndMinute: 18 * 60, timezone: "Asia/Kolkata" });
    // 2026-10-27 10:00 IST == 04:30 UTC.
    expect(new Date(resolved).toISOString()).toBe(new Date(Date.UTC(2026, 9, 27, 4, 30)).toISOString());
  });
});
