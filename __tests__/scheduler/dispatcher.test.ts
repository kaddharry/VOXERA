import { describe, it, expect, beforeEach, vi } from "vitest";
import { reconcileStuckCall } from "../../lib/scheduler/stuck-calls";

/**
 * Minimal chainable stand-in for the Supabase query builder. Every call is
 * recorded; awaiting the chain (or calling .single()/.maybeSingle())
 * resolves with whatever `respond` returns for that table + operation.
 */
type Op = { table: string; op: "select" | "update" | "insert"; payload?: any; filters: [string, ...any[]][] };
const ops: Op[] = [];
let respond: (op: Op) => { data: any; error: any } = () => ({ data: null, error: null });

function builder(table: string) {
  const op: Op = { table, op: "select", filters: [] };
  const result = () => {
    if (!ops.includes(op)) ops.push(op);
    return Promise.resolve(respond(op));
  };
  const chain: any = {
    select: () => chain,
    update: (payload: any) => ((op.op = "update"), (op.payload = payload), chain),
    insert: (payload: any) => ((op.op = "insert"), (op.payload = payload), chain),
    then: (resolve: any, reject: any) => result().then(resolve, reject),
    single: result,
    maybeSingle: result,
  };
  for (const f of ["eq", "in", "lte", "lt", "or", "order", "limit", "neq", "gte"]) {
    chain[f] = (...args: any[]) => (op.filters.push([f, ...args]), chain);
  }
  return chain;
}

vi.mock("../../lib/db/supabase", () => ({ supabase: { from: (table: string) => builder(table) } }));
vi.mock("../../lib/db/patients", () => ({ getPatientById: vi.fn() }));
vi.mock("../../lib/telephony/outbound", () => ({
  placeOutboundCall: vi.fn(async () => ({ callSid: "CA123", status: "queued" })),
  isLocalBaseUrl: (u: string) => /localhost|127\.0\.0\.1/.test(u),
}));

const { handleFollowUpCallOutcome, runDispatchCycle, reconcileStuckCalls } = await import("../../lib/scheduler/dispatcher");
const { getPatientById } = await import("../../lib/db/patients");

const baseTask = {
  id: "task1",
  clientId: "c1",
  patientId: "p1",
  timezone: "UTC",
  windowStartMinute: null,
  windowEndMinute: null,
  retryDelayMinutes: 30,
  finalAction: "needs_review",
  attemptCount: 1,
  maxAttempts: 3,
};

beforeEach(() => {
  ops.length = 0;
  respond = () => ({ data: null, error: null });
  vi.clearAllMocks();
});

const taskUpdates = () => ops.filter((o) => o.table === "follow_up_tasks" && o.op === "update");

describe("handleFollowUpCallOutcome", () => {
  it("does not touch a task that is no longer in flight (e.g. cancelled during the call)", async () => {
    respond = (op) => (op.table === "follow_up_tasks" && op.op === "select" ? { data: { ...baseTask, status: "cancelled" }, error: null } : { data: null, error: null });
    await handleFollowUpCallOutcome({ taskId: "task1", twilioStatus: "no-answer" });
    expect(taskUpdates()).toHaveLength(0);
  });

  it("retries a no-answer and only moves the task if it's still calling", async () => {
    respond = (op) => (op.table === "follow_up_tasks" && op.op === "select" ? { data: { ...baseTask, status: "calling" }, error: null } : { data: null, error: null });
    await handleFollowUpCallOutcome({ taskId: "task1", twilioStatus: "no-answer" });
    const [update] = taskUpdates();
    expect(update.payload.status).toBe("scheduled");
    expect(update.filters).toContainEqual(["eq", "status", "calling"]);
  });

  it("counts the attempt when the outcome beats the dispatcher (task still dispatching)", async () => {
    respond = (op) =>
      op.table === "follow_up_tasks" && op.op === "select" ? { data: { ...baseTask, status: "dispatching", attemptCount: 2 }, error: null } : { data: null, error: null };
    await handleFollowUpCallOutcome({ taskId: "task1", twilioStatus: "failed" });
    // attempt 3 of 3 just failed — exhausted, not another retry
    const [update] = taskUpdates();
    expect(update.payload.status).toBe("exhausted");
    expect(update.payload.attemptCount).toBe(3);
  });
});

describe("runDispatchCycle", () => {
  it("also reclaims tasks stuck in 'dispatching' with a stale lease", async () => {
    await runDispatchCycle("https://example.test");
    const claim = ops.find((o) => o.table === "follow_up_tasks" && o.op === "update");
    const orFilter = claim?.filters.find((f) => f[0] === "or")?.[1] as string;
    expect(orFilter).toContain("status.eq.scheduled");
    expect(orFilter).toContain("status.eq.dispatching");
  });

  it("marks a dispatched task calling with a start time, only if still dispatching", async () => {
    vi.mocked(getPatientById).mockResolvedValue({ id: "p1", phone: "+911234567890", doNotContact: false, assignedAgentId: "a1" } as any);
    respond = (op) =>
      op.table === "follow_up_tasks" && op.op === "update" && op.payload.status === "dispatching"
        ? { data: [{ id: "task1", patientId: "p1", clientId: "c1", agentId: "a1", attemptCount: 0 }], error: null }
        : { data: null, error: null };

    const result = await runDispatchCycle("https://example.test");

    expect(result).toEqual({ dispatched: 1, errors: 0 });
    const calling = taskUpdates().find((o) => o.payload.status === "calling");
    expect(calling?.payload.claimedAt).toEqual(expect.any(Number));
    expect(calling?.payload.claimedBy).toBe("call:CA123");
    expect(calling?.filters).toContainEqual(["eq", "status", "dispatching"]);
  });
});

describe("reconcileStuckCalls", () => {
  it("sends a long-stuck call with no call record to human review", async () => {
    respond = (op) => {
      if (op.table === "follow_up_tasks" && op.op === "select") return { data: [{ id: "task1", clientId: "c1", patientId: "p1" }], error: null };
      return { data: null, error: null };
    };
    const count = await reconcileStuckCalls();
    expect(count).toBe(1);
    expect(taskUpdates().find((o) => o.payload.status === "needs_review")).toBeTruthy();
    expect(ops.find((o) => o.table === "alerts" && o.op === "insert")).toBeTruthy();
  });

  it("leaves a call alone if it actually started recently", async () => {
    respond = (op) => {
      if (op.table === "follow_up_tasks" && op.op === "select") return { data: [{ id: "task1", clientId: "c1", patientId: "p1" }], error: null };
      if (op.table === "call_logs") return { data: { id: "CA1", sessionId: null, status: "active", startedAt: Date.now() - 60_000 }, error: null };
      return { data: null, error: null };
    };
    await reconcileStuckCalls();
    expect(taskUpdates()).toHaveLength(0);
  });
});

describe("reconcileStuckCall", () => {
  const now = 10_000_000_000;
  const MIN = 60_000;

  it("waits while a call is younger than 3 minutes", () => {
    expect(reconcileStuckCall({ now, claimedAt: now - 2 * MIN, call: null })).toEqual({ kind: "wait" });
  });

  it("applies a recorded end that was never acted on (after a 2-minute grace)", () => {
    const call = { status: "failed", startedAt: now - 10 * MIN, endedAt: now - 5 * MIN };
    expect(reconcileStuckCall({ now, claimedAt: null, call })).toEqual({ kind: "outcome", twilioStatus: "failed", followUpOutcome: undefined, endedAt: now - 5 * MIN });
    expect(reconcileStuckCall({ now, claimedAt: null, call: { ...call, endedAt: now - MIN } })).toEqual({ kind: "wait" });
  });

  it("uses the saved summary's verdict for a recorded completed call", () => {
    const call = { status: "completed", startedAt: now - 10 * MIN, endedAt: now - 5 * MIN, summary: { followUpOutcome: "resolved" as const } };
    expect(reconcileStuckCall({ now, claimedAt: null, call })).toMatchObject({ kind: "outcome", twilioStatus: "completed", followUpOutcome: "resolved" });
  });

  it("asks Twilio when no end was recorded, and applies Twilio's answer", () => {
    const call = { status: "outbound_initiated", startedAt: now - 5 * MIN, endedAt: null };
    expect(reconcileStuckCall({ now, claimedAt: null, call })).toEqual({ kind: "ask_twilio" });
    expect(reconcileStuckCall({ now, claimedAt: null, call, twilio: { status: "no-answer", endedAt: now - 4 * MIN } })).toEqual({
      kind: "outcome",
      twilioStatus: "no-answer",
      endedAt: now - 4 * MIN,
    });
  });

  it("keeps waiting while Twilio says the call is still in progress", () => {
    const call = { status: "active", startedAt: now - 20 * MIN, endedAt: null };
    expect(reconcileStuckCall({ now, claimedAt: null, call, twilio: { status: "in-progress", endedAt: null } })).toEqual({ kind: "wait" });
  });

  it("hands it to a human after 2 hours with no way to find out", () => {
    expect(reconcileStuckCall({ now, claimedAt: now - 3 * 60 * MIN, call: null, twilio: null })).toHaveProperty("kind", "needs_review");
    const call = { status: "active", startedAt: now - 3 * 60 * MIN, endedAt: null };
    expect(reconcileStuckCall({ now, claimedAt: null, call, twilio: null })).toHaveProperty("kind", "needs_review");
  });
});
