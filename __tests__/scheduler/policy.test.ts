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
