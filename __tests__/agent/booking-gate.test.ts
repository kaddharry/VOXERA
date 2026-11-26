import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "../helpers/fake-supabase";

/**
 * book_appointment through the real tool dispatcher: the model's severity claim is checked against the call,
 * routine requests are declined (and handed to staff), serious ones book and are scored.
 */
const hoisted = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("../helpers/fake-supabase").createFakeDb> & { rpc: (name: string, args: Record<string, any>) => Promise<unknown> } }));

vi.mock("../../lib/db/supabase", () => ({
  supabase: new Proxy({}, { get: (_t, prop) => (hoisted.db as any)[prop] }),
  isSupabaseHealthy: () => true,
  recordSupabaseSuccess: () => undefined,
  recordSupabaseFailure: () => undefined,
}));
vi.mock("../../lib/scheduler/appointment-reminders", () => ({
  scheduleAppointmentReminders: vi.fn(async () => undefined),
  cancelAppointmentReminders: vi.fn(async () => undefined),
  triggerWaitlistBackfill: vi.fn(async () => undefined),
}));

import { dispatchToolCall, getToolsForAgent } from "../../lib/agent/tools";

const startsAt = () => {
  const d = new Date(Date.now() + 2 * 86_400_000);
  // 10:00 clinic time (IST) on a day well in the future, on the 30-minute grid.
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  return `${ymd}T10:00:00+05:30`;
};

function seed(opts: { risk?: string; said?: string[]; lastCall?: Record<string, unknown> } = {}) {
  const fake = createFakeDb({
    tenants: [{ id: "t1", auth_user_id: "client-1" }],
    patients: [{ id: "pt1", clientId: "client-1", phone: "+911", riskLevel: opts.risk ?? "low", doNotContact: false }],
    providers: [{ id: "doc1", tenant_id: "t1", name: "Dr. Rao", status: "active", default_slot_minutes: 30, working_hours: null }],
    appointments: [],
    alerts: [],
    session_logs: (opts.said ?? []).map((text, i) => ({ sessionId: "s1", type: "utterance", ts: i, payload: { role: "user", text } })),
    call_logs: opts.lastCall ? [{ id: "c0", clientId: "client-1", patientId: "pt1", startedAt: 1, summary: opts.lastCall }] : [],
    medications: [{ id: "med1", clientId: "client-1", patientId: "pt1", name: "Metformin", status: "active", frequency: "daily", timesPerDay: 1, startDate: 0, createdAt: 0, updatedAt: 0 }],
    medication_adherence: [],
  });
  const db: any = fake;
  db.rpc = async (name: string, a: Record<string, any>) => {
    if (name !== "book_appointment_atomic") return { data: null, error: { message: "unknown rpc" } };
    const row = { id: `appt-${fake.tables.appointments.length + 1}`, tenant_id: a.p_tenant_id, client_id: a.p_client_id, provider_id: a.p_provider_id, patient_id: a.p_patient_id, starts_at: a.p_starts_at, ends_at: a.p_ends_at, visit_type: a.p_visit_type, status: "scheduled", notes: a.p_notes, booked_via: a.p_booked_via };
    fake.tables.appointments.push(row);
    return { data: row, error: null };
  };
  hoisted.db = db;
  return fake;
}

const ctx = { clientId: "client-1", sessionId: "s1", userId: "u1", patientId: "pt1" };
const book = (severity: string | undefined, reason = "caller said so") =>
  dispatchToolCall("book_appointment", { providerId: "doc1", startsAt: startsAt(), durationMinutes: 30, visitType: "consultation", severity, clinicalReason: reason }, ctx).then((r) => JSON.parse(r));

describe("book_appointment — only when genuinely serious", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declines a routine request, books nothing, and leaves a low-priority callback for staff", async () => {
    const db = seed({ said: ["Hello, I'd like an appointment for next week", "Any day is fine"] });
    const r = await book("routine", "wants a check-up");
    expect(r).toMatchObject({ success: false, declined: true, severity: "routine" });
    expect(r.error).toMatch(/Do NOT book/);
    expect(db.tables.appointments).toHaveLength(0);
    expect(db.tables.alerts).toHaveLength(1);
    expect(db.tables.alerts[0]).toMatchObject({ priority: "low", patientId: "pt1" });
    expect(db.tables.alerts[0].reason).toMatch(/Appointment requested \(routine\).*not booked by the assistant/);
  });

  it("does not let the model talk its way in: 'serious' with nothing to back it up is declined", async () => {
    const db = seed({ said: ["I just want to talk to the doctor"] });
    const r = await book("serious", "very serious!!");
    expect(r.declined).toBe(true);
    expect(db.tables.appointments).toHaveLength(0);
  });

  it("books a serious call, records the severity and a priority score, and says so", async () => {
    const db = seed({ said: ["The pain is unbearable and the wound is swollen"] });
    const r = await book("serious", "unbearable pain and swelling");
    expect(r).toMatchObject({ success: true, provider: "Dr. Rao" });
    expect(db.tables.appointments).toHaveLength(1);
    expect(db.tables.appointments[0]).toMatchObject({ patient_id: "pt1", booked_via: "ai_call", severity: "serious" });
    expect(db.tables.appointments[0].priority_score).toBeGreaterThanOrEqual(80);
    expect(db.tables.appointments[0].severity_reason).toMatch(/unbearable pain and swelling/);
  });

  it("books on a Hinglish and a Hindi complaint, too", async () => {
    for (const said of ["Mujhe bahut dard hai aur sujan badh rahi hai", "मुझे तेज बुखार है और चक्कर आ रहे हैं"]) {
      const db = seed({ said: [said] });
      const r = await book("serious", said);
      expect(r.success, said).toBe(true);
      expect(db.tables.appointments).toHaveLength(1);
    }
  });

  it("books a moderate complaint only for a high-risk patient or when the last call already flagged it", async () => {
    expect((await (async () => { seed({ said: ["a little pain"] }); return book("moderate"); })()).declined).toBe(true);
    seed({ said: ["a little pain"], risk: "high" });
    expect((await book("moderate")).success).toBe(true);
    seed({ said: ["a little pain"], lastCall: { flaggedConcerns: ["knee swollen"], painReported: { present: true, score: 6 } } });
    expect((await book("moderate")).success).toBe(true);
  });

  it("logs the decision for the call replay", async () => {
    const db = seed({ said: ["a little pain"] });
    await book("moderate");
    expect(db.tables.session_logs.some((e) => e.type === "triage_decision" && e.payload.allowed === false)).toBe(true);
  });

  it("still asks the model for severity and a reason", () => {
    const tool = getToolsForAgent(["book_appointment"])[0].function.parameters as { required: string[]; properties: Record<string, unknown> };
    expect(tool.required).toEqual(expect.arrayContaining(["severity", "clinicalReason"]));
    expect(Object.keys(tool.properties)).toEqual(expect.arrayContaining(["severity", "clinicalReason"]));
  });
});

describe("record_medication_adherence tool", () => {
  it("is offered only to agents that were given it", () => {
    expect(getToolsForAgent(["record_medication_adherence"]).map((t) => t.function.name)).toEqual(["record_medication_adherence"]);
    expect(getToolsForAgent(["book_appointment"]).map((t) => t.function.name)).not.toContain("record_medication_adherence");
  });

  it("records an answer for the caller's own medicine", async () => {
    const db = seed();
    const r = JSON.parse(await dispatchToolCall("record_medication_adherence", { medicationId: "med1", status: "missed", note: "felt nauseous" }, ctx));
    expect(r).toMatchObject({ success: true, recorded: "missed" });
    expect(db.tables.medication_adherence[0]).toMatchObject({ patientId: "pt1", medicationId: "med1", status: "missed", sessionId: "s1", source: "call" });
  });

  it("refuses an unknown medicine and a status the model made up", async () => {
    const db = seed();
    expect(JSON.parse(await dispatchToolCall("record_medication_adherence", { medicationId: "nope", status: "taken" }, ctx)).error).toMatch(/isn't on this patient's list/);
    expect(JSON.parse(await dispatchToolCall("record_medication_adherence", { medicationId: "med1", status: "maybe" }, ctx)).error).toMatch(/status must be/);
    expect(db.tables.medication_adherence).toHaveLength(0);
  });

  it("tells the agent when a medicine keeps being missed", async () => {
    seed();
    await dispatchToolCall("record_medication_adherence", { medicationId: "med1", status: "missed" }, { ...ctx, sessionId: "s1" });
    const r = JSON.parse(await dispatchToolCall("record_medication_adherence", { medicationId: "med1", status: "missed" }, { ...ctx, sessionId: "s2" }));
    expect(r.note).toMatch(/Often missed/);
  });
});
