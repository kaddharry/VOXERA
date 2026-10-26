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
vi.mock("../../lib/telephony/twilio", () => ({
  fetchCallStatus: vi.fn(async () => null),
  hangUpCall: vi.fn(async () => true),
  validateTwilioSignature: vi.fn(() => true),
}));

const { POST: statusCallback } = await import("../../app/api/telephony/status/route");
const dispatcher = await import("../../lib/scheduler/dispatcher");
const { generateCallSummary } = await import("../../lib/agent/call-summary");
const { placeOutboundCall } = await import("../../lib/telephony/outbound");
const { fetchCallStatus, hangUpCall } = await import("../../lib/telephony/twilio");
const { POST: amdCallback } = await import("../../app/api/telephony/amd/route");
const { planScheduleEdit, isClearable } = await import("../../lib/scheduler/schedules");
const { isValidTimeZone } = await import("../../lib/scheduler/validation");

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

async function callEnds(callStatus: string, opts: { callSid?: string; duration?: number; attempt?: number } = {}) {
  const body = new URLSearchParams({ CallSid: opts.callSid ?? "CA1", CallStatus: callStatus, ...(opts.duration != null && { CallDuration: String(opts.duration) }) });
  const query = `followUpTaskId=today${opts.attempt ? `&followUpAttempt=${opts.attempt}` : ""}`;
  const res = await statusCallback(
    new NextRequest(`https://example.test/api/telephony/status?${query}`, {
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

/* ------------------------------------------------------------------ */
/* Voicemail detection, per-attempt identity, restarts                 */
/* ------------------------------------------------------------------ */

async function amdSays(answeredBy: string, callSid = "CA1") {
  return amdCallback(
    new NextRequest("https://example.test/api/telephony/amd?followUpTaskId=today&followUpAttempt=1", {
      method: "POST",
      body: new URLSearchParams({ CallSid: callSid, AccountSid: "AC1", AnsweredBy: answeredBy, MachineDetectionDuration: "3100" }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
  );
}

describe("voicemail detection (Twilio AMD)", () => {
  it("hangs up on a machine and retries — even if the voicemail greeting was transcribed as speech", async () => {
    patientSaid("Hi, you've reached Kavya, leave a message after the tone."); // the greeting, picked up by speech-to-text
    expect((await amdSays("machine_start")).status).toBe(200);
    expect(db.tables.call_logs[0].answeredBy).toBe("machine_start");
    expect(hangUpCall).toHaveBeenCalledWith("CA1");

    await callEnds("completed", { duration: 6, attempt: 1 });
    expect(task()).toMatchObject({ status: "scheduled", lastOutcome: "voicemail" });
    expect(generateCallSummary).not.toHaveBeenCalled();
  });

  it("treats fax the same as voicemail", async () => {
    await amdSays("fax");
    await callEnds("completed", { duration: 4, attempt: 1 });
    expect(task().lastOutcome).toBe("voicemail");
  });

  it("only records a human answer: a human who hangs up straight away is still retried", async () => {
    await amdSays("human");
    expect(hangUpCall).not.toHaveBeenCalled();
    await callEnds("completed", { duration: 3, attempt: 1 });
    expect(task()).toMatchObject({ status: "scheduled", lastOutcome: "no_conversation" });
  });

  it("doesn't let a human answer alone count as success — the conversation decides", async () => {
    await amdSays("human");
    patientSaid("I'm fine, thanks, the wound is healing well.");
    vi.mocked(generateCallSummary).mockResolvedValue(summary("resolved") as never);
    await callEnds("completed", { duration: 120, attempt: 1 });
    expect(task().status).toBe("completed");
  });

  it("falls back to the transcript when detection is unsure ('unknown')", async () => {
    await amdSays("unknown");
    patientSaid("Hello?");
    vi.mocked(generateCallSummary).mockResolvedValue(summary("needs_review") as never);
    await callEnds("completed", { duration: 8, attempt: 1 });
    expect(task()).toMatchObject({ status: "scheduled", lastOutcome: "outcome_unclear" });
  });
});

describe("full day: exactly 3 calls, then stop", () => {
  it("places attempt 1, 2 and 3 about a minute apart and never a 4th", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(START);
    seed({ status: "scheduled", attemptCount: 0, claimedAt: null, claimedBy: null, nextAttemptAt: START });
    db.tables.call_logs = [];
    dispatcher.__installSchedulerForTests("https://example.test");

    const placedAt: number[] = [];
    vi.mocked(placeOutboundCall).mockImplementation(async (o: { followUpAttempt?: number }) => {
      placedAt.push(Date.now());
      return { callSid: `CA_attempt_${o.followUpAttempt}`, status: "queued" };
    });

    const endedAt: number[] = [];
    await dispatcher.__runCycleForTests(); // attempt 1 at the scheduled time
    expect(placedAt[0]).toBe(START);
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(task()).toMatchObject({ status: "calling", attemptCount: attempt, claimedBy: `call:CA_attempt_${attempt}` });
      await vi.advanceTimersByTimeAsync(20_000); // the call rings for 20s, nobody answers
      endedAt.push(Date.now());
      await callEnds("no-answer", { callSid: `CA_attempt_${attempt}`, attempt });
      await vi.advanceTimersByTimeAsync(62_000); // retry delay + wake margin
    }

    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(placeOutboundCall).toHaveBeenCalledTimes(3);
    // Each retry goes out 60s after the previous call ended (+ the 250ms wake margin), not at the next 30s poll.
    for (const n of [1, 2]) {
      const gap = placedAt[n] - endedAt[n - 1];
      expect(gap).toBeGreaterThanOrEqual(MIN);
      expect(gap).toBeLessThanOrEqual(MIN + 1_000);
    }
    expect(task()).toMatchObject({ status: "needs_review", attemptCount: 3 });
    expect(db.tables.alerts).toHaveLength(1);
    expect(task("tomorrow")).toMatchObject({ status: "scheduled", attemptCount: 0 });
  });
});

describe("late and out-of-order callbacks", () => {
  it("ignores a late callback from attempt 1 once attempt 2 is calling", async () => {
    await callEnds("no-answer", { callSid: "CA1", attempt: 1 });
    // Attempt 2 goes out.
    db.tables.follow_up_tasks[0] = { ...task(), status: "calling", attemptCount: 2, claimedBy: "call:CA2", claimedAt: Date.now() };
    const before = JSON.stringify(task());
    await callEnds("no-answer", { callSid: "CA1", attempt: 1 });
    expect(JSON.stringify(task())).toBe(before);
  });

  it("ignores a callback for a different call even without an attempt number", async () => {
    db.tables.follow_up_tasks[0] = { ...task(), attemptCount: 2, claimedBy: "call:CA2" };
    const before = JSON.stringify(task());
    await callEnds("busy", { callSid: "CA1" });
    expect(JSON.stringify(task())).toBe(before);
  });

  it("never reopens a completed day", async () => {
    db.tables.follow_up_tasks[0] = { ...task(), status: "completed" };
    await callEnds("no-answer", { attempt: 1 });
    expect(task().status).toBe("completed");
  });

  it("ignores a summary that finishes after staff already changed the task", async () => {
    patientSaid("Yes, all good.");
    let finish!: (v: unknown) => void;
    vi.mocked(generateCallSummary).mockImplementation(() => new Promise((r) => (finish = r)) as never);
    const pending = statusCallback(
      new NextRequest("https://example.test/api/telephony/status?followUpTaskId=today&followUpAttempt=1", {
        method: "POST",
        body: "CallSid=CA1&CallStatus=completed&CallDuration=60",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
    await pending;
    await vi.waitFor(() => expect(generateCallSummary).toHaveBeenCalled());
    db.tables.follow_up_tasks[0] = { ...task(), status: "cancelled" }; // staff cancelled meanwhile
    finish(summary("needs_retry"));
    await new Promise((r) => setTimeout(r, 20));
    expect(task().status).toBe("cancelled");
  });
});

describe("server restart", () => {
  it("picks up a retry that came due while the server was down, from the database alone", async () => {
    // Persisted state: attempt 1 failed, retry was due 5 minutes ago.
    seed({ status: "scheduled", attemptCount: 1, claimedAt: null, claimedBy: null, nextAttemptAt: Date.now() - 5 * MIN, lastOutcome: "no-answer" });
    dispatcher.__resetSchedulerForTests(); // nothing in memory survives
    dispatcher.__installSchedulerForTests("https://example.test");
    await dispatcher.__runCycleForTests(); // the first poll after start-up
    expect(placeOutboundCall).toHaveBeenCalledTimes(1);
    expect(vi.mocked(placeOutboundCall).mock.calls[0][0]).toMatchObject({ followUpTaskId: "today", followUpAttempt: 2 });
    expect(task()).toMatchObject({ status: "calling", attemptCount: 2 });
  });

  it("re-claims a task left mid-dispatch by a crash, after its 2-minute lease", async () => {
    seed({ status: "dispatching", attemptCount: 1, claimedAt: Date.now() - 3 * MIN, claimedBy: "worker-dead", nextAttemptAt: Date.now() - 4 * MIN });
    dispatcher.__installSchedulerForTests("https://example.test");
    await dispatcher.__runCycleForTests();
    expect(placeOutboundCall).toHaveBeenCalledTimes(1);
    expect(task()).toMatchObject({ status: "calling", attemptCount: 2 });
  });
});

describe("schedule editing and clearing (PR #99) can't touch an active retry", () => {
  const asTask = (t: Record<string, unknown>) => t as never;
  it("an edit leaves a retrying day alone", () => {
    seed({ status: "scheduled", attemptCount: 1, scheduledDate: "2026-10-28", nextAttemptAt: ist("2026-10-28", 9) });
    const plan = planScheduleEdit({ kind: "range", tasks: [asTask(task()), asTask(task("tomorrow"))] }, { minute: 700 }, Date.now(), isValidTimeZone);
    if (plan.ok) {
      expect(plan.update.map((u) => u.taskId)).not.toContain("today");
      expect(plan.cancel).not.toContain("today");
    }
  });

  it("clearing never includes a retrying or calling day", () => {
    for (const status of ["scheduled", "calling", "dispatching"]) {
      seed({ status, attemptCount: 1 });
      expect(isClearable([asTask(task())], Date.now())).toBe(false);
    }
  });
});
