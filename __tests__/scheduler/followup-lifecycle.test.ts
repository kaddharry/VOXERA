import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeDb } from "../helpers/fake-supabase";
import { zonedDateTimeToMs } from "../../lib/scheduler/schedules";

/**
 * End-to-end follow-up lifecycle against an in-memory database:
 * a call ends (Twilio status callback) → the outcome is decided → the task
 * is retried / completed / exhausted / cancelled → the scheduler places the
 * next call on time. Twilio, the LLM summary and outbound dialing are
 * mocked; everything between them runs for real.
 */

let db: ReturnType<typeof createFakeDb>;

vi.mock("../../lib/db/supabase", () => ({
  supabase: { from: (t: string) => db.from(t) },
  isSupabaseHealthy: () => true,
  recordSupabaseSuccess: () => {},
  recordSupabaseFailure: () => {},
}));
vi.mock("../../lib/agent/call-summary", () => ({ generateCallSummary: vi.fn() }));
vi.mock("../../lib/db/demo-requests", () => ({ updateDemoRequestStatusByCallSid: vi.fn(async () => {}) }));
vi.mock("../../lib/telephony/outbound", () => ({
  placeOutboundCall: vi.fn(async () => ({ callSid: `CA_next_${Math.random().toString(36).slice(2, 6)}`, status: "queued" })),
  isLocalBaseUrl: () => false,
}));
vi.mock("../../lib/telephony/twilio", () => ({ fetchCallStatus: vi.fn(async () => null) }));

const { POST: statusCallback } = await import("../../app/api/telephony/status/route");
const dispatcher = await import("../../lib/scheduler/dispatcher");
const { generateCallSummary } = await import("../../lib/agent/call-summary");
const { placeOutboundCall } = await import("../../lib/telephony/outbound");
const { fetchCallStatus } = await import("../../lib/telephony/twilio");

const TZ = "Asia/Kolkata";
const ist = (date: string, hh: number, mm = 0) => zonedDateTimeToMs(date, hh * 60 + mm, TZ);
const START = ist("2026-10-27", 10, 0); // first call placed 10:00 IST
const MIN = 60_000;

function seed(task: Record<string, unknown> = {}, opts: { withSession?: boolean } = {}) {
  db = createFakeDb({
    patients: [{ id: "p1", clientId: "c1", name: "Kavya", phone: "+911", doNotContact: false, assignedAgentId: "a1" }],
    follow_up_tasks: [
      {
        id: "today",
        clientId: "c1",
        patientId: "p1",
        agentId: "a1",
        status: "calling",
        nextAttemptAt: START,
        timezone: TZ,
        windowStartMinute: null,
        windowEndMinute: null,
        maxAttempts: 3,
        attemptCount: 1,
        retryDelayMinutes: 1,
        finalAction: "needs_review",
        lastOutcome: null,
        claimedAt: START,
        claimedBy: "call:CA1",
        rangeGroupId: "range_1",
        scheduledDate: "2026-10-27",
        scheduledMinute: 600,
        ...task,
      },
      {
        id: "tomorrow",
        clientId: "c1",
        patientId: "p1",
        agentId: "a1",
        status: "scheduled",
        nextAttemptAt: ist("2026-10-28", 10),
        timezone: TZ,
        maxAttempts: 3,
        attemptCount: 0,
        retryDelayMinutes: 1,
        finalAction: "needs_review",
        rangeGroupId: "range_1",
        scheduledDate: "2026-10-28",
        scheduledMinute: 600,
      },
    ],
    call_logs: [
      {
        id: "CA1",
        clientId: "c1",
        patientId: "p1",
        followUpTaskId: "today",
        sessionId: opts.withSession === false ? null : "S1",
        status: "active",
        startedAt: START,
        endedAt: null,
      },
    ],
    session_logs: [{ id: "u0", sessionId: "S1", type: "utterance", payload: { role: "agent", text: "Hi Kavya, it's the clinic checking in." } }],
    alerts: [],
  });
}

const task = (id = "today") => db.tables.follow_up_tasks.find((t) => t.id === id)!;
const patientSaid = (text: string) =>
  db.tables.session_logs.push({ id: `u${db.tables.session_logs.length}`, sessionId: "S1", type: "utterance", payload: { role: "user", text } });

async function callEnds(callStatus: string, opts: { callSid?: string; duration?: number } = {}) {
  const body = new URLSearchParams({ CallSid: opts.callSid ?? "CA1", CallStatus: callStatus, ...(opts.duration != null && { CallDuration: String(opts.duration) }) });
  const res = await statusCallback(
    new NextRequest("https://example.test/api/telephony/status?followUpTaskId=today", {
      method: "POST",
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
  );
  // Outcome handling continues after the webhook responds; let it settle.
  await vi.waitFor(() => expect(["calling", "dispatching"]).not.toContain(task().status), { timeout: 2000 }).catch(() => {});
  return res;
}

const summary = (followUpOutcome: string, extra: Record<string, unknown> = {}) => ({
  sentimentTrajectory: "",
  flaggedConcerns: [],
  recommendedAction: "",
  followUpOutcome,
  requestedDoNotContact: false,
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START + 2 * MIN); // the call ends 2 minutes after it started
  vi.clearAllMocks();
  dispatcher.__resetSchedulerForTests();
  seed();
});
afterEach(() => {
  dispatcher.__resetSchedulerForTests();
  vi.useRealTimers();
});

describe("calls that never connect", () => {
  it.each(["no-answer", "busy", "failed", "canceled"])("retries after %s, one minute after the call ended", async (status) => {
    const endedAt = Date.now();
    await callEnds(status);
    expect(task()).toMatchObject({ status: "scheduled", attemptCount: 1, lastOutcome: status, nextAttemptAt: endedAt + MIN, claimedAt: null });
    expect(generateCallSummary).not.toHaveBeenCalled();
  });
});

describe("calls that connect", () => {
  it("retries when the patient hangs up without saying anything (no summary needed)", async () => {
    const endedAt = Date.now();
    await callEnds("completed", { duration: 4 });
    expect(task()).toMatchObject({ status: "scheduled", lastOutcome: "no_conversation", nextAttemptAt: endedAt + MIN });
    expect(generateCallSummary).not.toHaveBeenCalled();
  });

  it("retries when the call connected but the audio stream never started", async () => {
    seed({}, { withSession: false });
    await callEnds("completed", { duration: 2 });
    expect(task()).toMatchObject({ status: "scheduled", lastOutcome: "no_conversation" });
  });

  it("completes the day after a real, resolved conversation — and leaves tomorrow alone", async () => {
    patientSaid("I'm feeling much better, the pain is gone.");
    vi.mocked(generateCallSummary).mockResolvedValue(summary("resolved") as never);
    const tomorrowBefore = JSON.stringify(task("tomorrow"));
    await callEnds("completed", { duration: 180 });
    expect(task()).toMatchObject({ status: "completed", lastOutcome: "resolved", attemptCount: 1 });
    expect(JSON.stringify(task("tomorrow"))).toBe(tomorrowBefore);
  });

  it("retries when the patient asks to be called back", async () => {
    patientSaid("I'm driving, can you call me later?");
    vi.mocked(generateCallSummary).mockResolvedValue(summary("needs_retry") as never);
    await callEnds("completed", { duration: 20 });
    expect(task()).toMatchObject({ status: "scheduled", lastOutcome: "call_back_requested" });
  });

  it("retries when the summary can't tell whether the follow-up happened", async () => {
    patientSaid("Hello? Hello?");
    vi.mocked(generateCallSummary).mockResolvedValue(summary("needs_review") as never);
    await callEnds("completed", { duration: 15 });
    expect(task()).toMatchObject({ status: "scheduled", lastOutcome: "outcome_unclear" });
  });

  it("retries (never completes) when the summary is missing", async () => {
    patientSaid("Yes.");
    vi.mocked(generateCallSummary).mockResolvedValue(null as never);
    await callEnds("completed", { duration: 30 });
    expect(task()).toMatchObject({ status: "scheduled", lastOutcome: "outcome_unclear" });
  });

  it("retries (never completes) when the summary fails", async () => {
    patientSaid("Yes.");
    vi.mocked(generateCallSummary).mockRejectedValue(new Error("LLM down"));
    await callEnds("completed", { duration: 30 });
    expect(task()).toMatchObject({ status: "scheduled", lastOutcome: "outcome_unclear" });
  });

  it("times the retry from the call's end even when the summary is slow", async () => {
    patientSaid("Sorry, bad time.");
    const endedAt = Date.now();
    vi.mocked(generateCallSummary).mockImplementation(async () => {
      vi.setSystemTime(endedAt + 25_000); // summary takes 25 seconds
      return summary("needs_retry") as never;
    });
    await callEnds("completed", { duration: 10 });
    expect(task().nextAttemptAt).toBe(endedAt + MIN);
  });
});

describe("limits and stopping", () => {
  it("stops after the last attempt and raises a review alert", async () => {
    seed({ attemptCount: 3 });
    const tomorrowBefore = JSON.stringify(task("tomorrow"));
    await callEnds("no-answer");
    expect(task()).toMatchObject({ status: "needs_review", attemptCount: 3 });
    expect(db.tables.alerts).toHaveLength(1);
    expect(db.tables.alerts[0]).toMatchObject({ followUpTaskId: "today", callId: "CA1", sessionId: "S1" });
    expect(db.tables.alerts[0].reason).toMatch(/All 3 attempts.*no answer/);
    expect(JSON.stringify(task("tomorrow"))).toBe(tomorrowBefore);
  });

  it("applies a different final action when configured", async () => {
    seed({ attemptCount: 3, finalAction: "cancelled" });
    await callEnds("busy");
    expect(task().status).toBe("cancelled");
    expect(db.tables.alerts).toHaveLength(0);
  });

  it("never retries after the patient asks not to be called, and cancels their other days", async () => {
    patientSaid("Please stop calling me.");
    vi.mocked(generateCallSummary).mockResolvedValue(summary("needs_retry", { requestedDoNotContact: true }) as never);
    await callEnds("completed", { duration: 40 });
    expect(task()).toMatchObject({ status: "cancelled", lastOutcome: "do_not_contact" });
    expect(task("tomorrow").status).toBe("cancelled");
    expect(db.tables.patients[0].doNotContact).toBe(true);
  });

  it("doesn't retry a patient who was marked do-not-contact during the call", async () => {
    db.tables.patients[0].doNotContact = true;
    await callEnds("no-answer");
    expect(task()).toMatchObject({ status: "cancelled", lastOutcome: "do_not_contact" });
  });
});

describe("idempotency", () => {
  it("ignores a duplicate status callback: no extra attempt, no second change", async () => {
    await callEnds("no-answer");
    const afterFirst = JSON.stringify(task());
    vi.setSystemTime(Date.now() + 5_000);
    await callEnds("no-answer");
    expect(JSON.stringify(task())).toBe(afterFirst);
  });

  it("applies an outcome that arrives before the dispatcher marked the task 'calling', counting that attempt once", async () => {
    seed({ status: "dispatching", attemptCount: 0 });
    await callEnds("failed");
    expect(task()).toMatchObject({ status: "scheduled", attemptCount: 1, lastOutcome: "failed" });
  });
});

describe("calling window and timezone", () => {
  it("moves a retry that would land after the window closes to the window's next opening", async () => {
    seed({ windowStartMinute: 9 * 60, windowEndMinute: 18 * 60 });
    vi.setSystemTime(ist("2026-10-27", 17, 59, ) + 30_000); // 17:59:30 IST
    await callEnds("no-answer");
    expect(task().nextAttemptAt).toBe(ist("2026-10-28", 9, 0));
  });

  it("keeps a retry inside the window at exactly call end + delay", async () => {
    seed({ windowStartMinute: 9 * 60, windowEndMinute: 18 * 60, retryDelayMinutes: 30 });
    vi.setSystemTime(ist("2026-10-27", 14, 0));
    await callEnds("busy");
    expect(task().nextAttemptAt).toBe(ist("2026-10-27", 14, 30));
  });
});

describe("the scheduler places the retry on time", () => {
  it("wakes for a one-minute retry instead of waiting for the next 30-second poll", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(START + 2 * MIN);
    dispatcher.__installSchedulerForTests("https://example.test");

    const endedAt = Date.now();
    await callEnds("no-answer");
    expect(task()).toMatchObject({ status: "scheduled", nextAttemptAt: endedAt + MIN });
    expect(placeOutboundCall).not.toHaveBeenCalled();

    // Just before it's due: nothing yet.
    await vi.advanceTimersByTimeAsync(MIN - 1_000);
    expect(placeOutboundCall).not.toHaveBeenCalled();

    // Due (plus the small wake margin): the next call is placed.
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(placeOutboundCall).toHaveBeenCalledTimes(1));
    expect(vi.mocked(placeOutboundCall).mock.calls[0][0]).toMatchObject({ followUpTaskId: "today", patientId: "p1" });
    expect(task()).toMatchObject({ status: "calling", attemptCount: 2 });
  });
});

describe("missing status callbacks", () => {
  const fromStart = (ms: number) => vi.setSystemTime(START + ms);

  it("asks Twilio after a few minutes and retries a call it says went unanswered", async () => {
    fromStart(5 * MIN);
    vi.mocked(fetchCallStatus).mockResolvedValue({ status: "no-answer", durationSec: 0, endedAt: START + MIN });
    await dispatcher.reconcileStuckCalls();
    expect(fetchCallStatus).toHaveBeenCalledWith("CA1");
    expect(task()).toMatchObject({ status: "scheduled", lastOutcome: "no-answer", nextAttemptAt: START + 2 * MIN });
    expect(db.tables.call_logs[0]).toMatchObject({ status: "failed", endedAt: START + MIN });
  });

  it("treats a completed call with no patient speech as not reached", async () => {
    fromStart(6 * MIN);
    vi.mocked(fetchCallStatus).mockResolvedValue({ status: "completed", durationSec: 3, endedAt: START + MIN });
    await dispatcher.reconcileStuckCalls();
    expect(task()).toMatchObject({ status: "scheduled", lastOutcome: "no_conversation" });
  });

  it("leaves a call Twilio says is still in progress alone", async () => {
    fromStart(20 * MIN);
    vi.mocked(fetchCallStatus).mockResolvedValue({ status: "in-progress", durationSec: null, endedAt: null });
    await dispatcher.reconcileStuckCalls();
    expect(task().status).toBe("calling");
  });

  it("finishes the job when the callback arrived but its processing didn't", async () => {
    db.tables.call_logs[0] = { ...db.tables.call_logs[0], status: "failed", endedAt: START + MIN };
    fromStart(5 * MIN);
    await dispatcher.reconcileStuckCalls();
    expect(fetchCallStatus).not.toHaveBeenCalled();
    expect(task()).toMatchObject({ status: "scheduled", nextAttemptAt: START + 2 * MIN });
  });

  it("raises a review alert after 2 hours when Twilio can't tell us either", async () => {
    fromStart(3 * 60 * MIN);
    vi.mocked(fetchCallStatus).mockResolvedValue(null);
    await dispatcher.reconcileStuckCalls();
    expect(task().status).toBe("needs_review");
    expect(db.tables.alerts).toHaveLength(1);
  });

  it("does nothing for a call that only just started", async () => {
    fromStart(MIN);
    await dispatcher.reconcileStuckCalls();
    expect(fetchCallStatus).not.toHaveBeenCalled();
    expect(task().status).toBe("calling");
  });
});
