import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeDb } from "../helpers/fake-supabase";
import { zonedDateTimeToMs } from "../../lib/scheduler/schedules";

/**
 * Endpoint tests for editing a schedule and clearing past schedules, run
 * against an in-memory database so they show which rows really change.
 */

const TZ = "Asia/Kolkata";
const ist = (date: string, hh: number, mm = 0) => zonedDateTimeToMs(date, hh * 60 + mm, TZ);
const NOW = ist("2026-10-26", 15, 30); // 26 Oct 2026, 3:30 pm Kolkata

let db: ReturnType<typeof createFakeDb>;
let currentUser: { id: string } | null;

vi.mock("../../lib/db/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
    from: (t: string) => db.from(t),
  }),
}));

const { PATCH, GET } = await import("../../app/api/admin/patients/[id]/schedules/[scheduleId]/route");
const { POST: CLEAR } = await import("../../app/api/admin/patients/[id]/schedules/clear-past/route");

function day(id: string, date: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    clientId: "hospital-a",
    patientId: "kavya",
    agentId: "agent-a",
    status: "scheduled",
    nextAttemptAt: ist(date, 10),
    timezone: TZ,
    windowStartMinute: null,
    windowEndMinute: null,
    maxAttempts: 3,
    attemptCount: 0,
    retryDelayMinutes: 30,
    finalAction: "needs_review",
    lastOutcome: null,
    pausedAt: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: 0,
    claimedAt: null,
    claimedBy: null,
    rangeGroupId: "range_k",
    programmeId: null,
    programmeStepLabel: null,
    scheduledDate: date,
    scheduledMinute: 600,
    archivedAt: null,
    ...overrides,
  };
}

function seed() {
  db = createFakeDb({
    patients: [
      { id: "kavya", clientId: "hospital-a", name: "Kavya", phone: "+911", doNotContact: false, assignedAgentId: "agent-a" },
      { id: "ravi", clientId: "hospital-b", name: "Ravi", phone: "+912", doNotContact: false, assignedAgentId: null },
    ],
    tenants: [
      { id: "tenant-a", auth_user_id: "hospital-a" },
      { id: "tenant-b", auth_user_id: "hospital-b" },
    ],
    agents: [
      { id: "agent-a", tenant_id: "tenant-a" },
      { id: "agent-a2", tenant_id: "tenant-a" },
      { id: "agent-b", tenant_id: "tenant-b" },
    ],
    follow_up_tasks: [
      // Current range: 24th–29th
      day("d24", "2026-10-24", { status: "completed", attemptCount: 1, completedAt: ist("2026-10-24", 10, 5) }),
      day("d25", "2026-10-25", { status: "exhausted", attemptCount: 3 }),
      day("d26", "2026-10-26", { status: "scheduled", attemptCount: 1, nextAttemptAt: ist("2026-10-26", 16) }), // today, retrying
      day("d27", "2026-10-27"),
      day("d28", "2026-10-28", { status: "calling", attemptCount: 1 }), // future day oddly already calling
      day("d29", "2026-10-29"),
      // Finished range from earlier in the month
      day("o10", "2026-10-10", { rangeGroupId: "range_old", status: "completed", attemptCount: 1 }),
      day("o11", "2026-10-11", { rangeGroupId: "range_old", status: "needs_review", attemptCount: 3 }),
      // A single follow-up that finished today
      day("s26", "2026-10-26", { rangeGroupId: null, status: "completed", attemptCount: 1 }),
      // Another hospital's patient
      day("b1", "2026-10-20", { clientId: "hospital-b", patientId: "ravi", rangeGroupId: "range_b", status: "completed" }),
    ],
    call_logs: [
      { id: "CA1", clientId: "hospital-a", followUpTaskId: "d24", sessionId: "s1", status: "completed", startedAt: ist("2026-10-24", 10), endedAt: null, durationMs: 60000, summary: { followUpOutcome: "resolved" } },
      { id: "CAB", clientId: "hospital-b", followUpTaskId: "d24", sessionId: "sb", status: "completed", startedAt: 0, endedAt: null, durationMs: 1, summary: null },
    ],
    alerts: [{ id: "al1", clientId: "hospital-a", followUpTaskId: "d25", reason: "All scheduled attempts exhausted", status: "open", createdAt: 1 }],
  });
}

const task = (id: string) => db.tables.follow_up_tasks.find((t) => t.id === id)!;
const snapshot = (ids: string[]) => JSON.stringify(ids.map((id) => task(id)));
const patch = (body: unknown, patient = "kavya", schedule = "range:range_k") =>
  PATCH(
    new NextRequest("https://x.test/api", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    { params: Promise.resolve({ id: patient, scheduleId: encodeURIComponent(schedule) }) },
  );
const clear = (patient = "kavya") => CLEAR(new NextRequest("https://x.test/api", { method: "POST" }), { params: Promise.resolve({ id: patient }) });

beforeEach(() => {
  seed();
  currentUser = { id: "hospital-a" };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("editing a schedule (server-side rules)", () => {
  it("changes only editable future days and leaves today, the past and in-progress days untouched (4, 7)", async () => {
    const protectedIds = ["d24", "d25", "d26", "d28"];
    const before = snapshot(protectedIds);

    const res = await patch({ dates: ["2026-10-27", "2026-10-29", "2026-10-30"], minute: 11 * 60 + 30 });
    expect(res.status).toBe(200);

    expect(snapshot(protectedIds)).toBe(before);
    expect(task("d27")).toMatchObject({ scheduledMinute: 690, nextAttemptAt: ist("2026-10-27", 11, 30), status: "scheduled" });
    expect(task("d29")).toMatchObject({ scheduledMinute: 690, nextAttemptAt: ist("2026-10-29", 11, 30) });
    const added = db.tables.follow_up_tasks.filter((t) => t.scheduledDate === "2026-10-30");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ rangeGroupId: "range_k", patientId: "kavya", clientId: "hospital-a", status: "scheduled", attemptCount: 0 });
  });

  it("cancels a removed future day instead of deleting it", async () => {
    const count = db.tables.follow_up_tasks.length;
    const res = await patch({ dates: ["2026-10-27"] });
    expect(res.status).toBe(200);
    expect(db.tables.follow_up_tasks).toHaveLength(count);
    expect(task("d29")).toMatchObject({ status: "cancelled", lastOutcome: "removed_from_schedule" });
  });

  it("rejects an edit to today's date (4)", async () => {
    const before = snapshot(db.tables.follow_up_tasks.map((t) => t.id));
    const res = await patch({ dates: ["2026-10-26", "2026-10-27"] });
    expect(res.status).toBe(409);
    expect((await res.json()).lockedDates).toEqual(["2026-10-26"]);
    expect(snapshot(db.tables.follow_up_tasks.map((t) => t.id))).toBe(before);
  });

  it("rejects the whole edit if a date became locked at midnight before it arrived (5)", async () => {
    vi.setSystemTime(ist("2026-10-27", 0, 0) + 5_000); // just after midnight in Kolkata
    const before = snapshot(db.tables.follow_up_tasks.map((t) => t.id));
    const res = await patch({ dates: ["2026-10-27", "2026-10-29"], minute: 700 });
    expect(res.status).toBe(409);
    expect((await res.json()).lockedDates).toEqual(["2026-10-27"]);
    expect(snapshot(db.tables.follow_up_tasks.map((t) => t.id))).toBe(before);
  });

  it("keeps retry settings and agent when only the time changes, and applies them when changed (6)", async () => {
    await patch({ minute: 9 * 60 });
    expect(task("d27")).toMatchObject({ maxAttempts: 3, retryDelayMinutes: 30, agentId: "agent-a", scheduledMinute: 540 });

    await patch({ maxAttempts: 5, retryDelayMinutes: 15, agentId: "agent-a2" });
    expect(task("d29")).toMatchObject({ maxAttempts: 5, retryDelayMinutes: 15, agentId: "agent-a2", scheduledMinute: 540 });
    expect(task("d26")).toMatchObject({ maxAttempts: 3, agentId: "agent-a" }); // today unchanged
  });

  it("refuses another hospital's agent (9)", async () => {
    const res = await patch({ agentId: "agent-b" });
    expect(res.status).toBe(400);
    expect(task("d27").agentId).toBe("agent-a");
  });

  it("can't see or edit another hospital's patient or schedule (9)", async () => {
    expect((await patch({ minute: 700 }, "ravi", "range:range_b")).status).toBe(404);
    currentUser = { id: "hospital-b" };
    expect((await patch({ minute: 700 }, "kavya", "range:range_k")).status).toBe(404);
    expect(task("d27").scheduledMinute).toBe(600);
  });

  it("requires login (9)", async () => {
    currentUser = null;
    expect((await patch({ minute: 700 })).status).toBe(401);
  });
});

describe("schedule details", () => {
  it("shows only this hospital's calls and alerts for the schedule's days", async () => {
    const res = await GET(new NextRequest("https://x.test/api"), {
      params: Promise.resolve({ id: "kavya", scheduleId: encodeURIComponent("range:range_k") }),
    });
    const body = await res.json();
    expect(body.schedule.section).toBe("current");
    expect(body.calls.map((c: { id: string }) => c.id)).toEqual(["CA1"]);
    expect(body.calls[0].outcome).toBe("resolved");
    expect(body.alerts.map((a: { id: string }) => a.id)).toEqual(["al1"]);
  });
});

describe("clearing past schedules (8)", () => {
  it("archives only finished, past schedules — never current, today's, or another hospital's", async () => {
    const res = await clear();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ clearedSchedules: 1, archivedTasks: 2 });

    expect(task("o10").archivedAt).toBe(NOW);
    expect(task("o11").archivedAt).toBe(NOW);
    for (const id of ["d24", "d25", "d26", "d27", "d28", "d29", "s26", "b1"]) {
      expect(task(id).archivedAt).toBeNull();
    }
  });

  it("never clears a finished-looking schedule with an old day still paused or stuck calling", async () => {
    db.tables.follow_up_tasks.push(
      day("p1", "2026-10-05", { rangeGroupId: "range_stuck", status: "completed", attemptCount: 1 }),
      day("p2", "2026-10-06", { rangeGroupId: "range_stuck", status: "calling", attemptCount: 1 }),
      day("q1", "2026-10-07", { rangeGroupId: "range_paused", status: "paused" }),
    );
    await clear();
    for (const id of ["p1", "p2", "q1"]) expect(task(id).archivedAt).toBeNull();
  });

  it("deletes nothing and leaves call logs and alerts alone", async () => {
    const before = { tasks: db.tables.follow_up_tasks.length, calls: JSON.stringify(db.tables.call_logs), alerts: JSON.stringify(db.tables.alerts) };
    await clear();
    expect(db.tables.follow_up_tasks).toHaveLength(before.tasks);
    expect(JSON.stringify(db.tables.call_logs)).toBe(before.calls);
    expect(JSON.stringify(db.tables.alerts)).toBe(before.alerts);
  });

  it("takes no task ids from the request", async () => {
    // Even a crafted body can't widen what gets cleared.
    const res = await CLEAR(
      new NextRequest("https://x.test/api", { method: "POST", body: JSON.stringify({ taskIds: ["d27", "d29", "b1"] }) }),
      { params: Promise.resolve({ id: "kavya" }) },
    );
    expect(res.status).toBe(200);
    for (const id of ["d27", "d29", "b1"]) expect(task(id).archivedAt).toBeNull();
  });

  it("is scoped to the logged-in hospital and patient (9)", async () => {
    currentUser = { id: "hospital-b" };
    expect((await clear("kavya")).status).toBe(404);
    expect(task("o10").archivedAt).toBeNull();
    currentUser = null;
    expect((await clear("kavya")).status).toBe(401);
  });

  it("cleared schedules disappear from the patient's schedule list", async () => {
    await clear();
    const { GET: LIST } = await import("../../app/api/admin/patients/[id]/follow-ups/route");
    const body = await (await LIST(new NextRequest("https://x.test/api"), { params: Promise.resolve({ id: "kavya" }) })).json();
    expect(body.schedules.map((s: { id: string }) => s.id).sort()).toEqual(["range:range_k", "task:s26"]);
  });
});
