import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeDb } from "../helpers/fake-supabase";

/**
 * THE USER STORY, end to end (docs/USER_STORY_FLOW.md):
 *   admin adds a doctor login → assigns a patient → doctor prescribes → the agent calls: asks about last call's pain
 *   and the medicine → records misses → the doctor is alerted → a routine booking is declined, a serious one booked →
 *   the doctor cancels the unimportant visit, refers the patient, and instructs the agent → admin approves → the next
 *   call carries it.
 */
const state = vi.hoisted(() => ({ userId: null as string | null, db: null as any }));
vi.mock("../../lib/db/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId, email: `${state.userId}@h.test`, user_metadata: {} } : null } }) },
    from: (t: string) => state.db.from(t),
  }),
}));
vi.mock("../../lib/db/supabase", () => ({
  supabase: new Proxy({}, { get: (_t, prop) => state.db[prop] }),
  isSupabaseHealthy: () => true,
  recordSupabaseSuccess: () => undefined,
  recordSupabaseFailure: () => undefined,
}));
vi.mock("../../lib/scheduler/appointment-reminders", () => ({ scheduleAppointmentReminders: vi.fn(async () => undefined), cancelAppointmentReminders: vi.fn(async () => undefined), triggerWaitlistBackfill: vi.fn(async () => undefined) }));
vi.mock("../../lib/telephony/sms", () => ({ sendSMS: vi.fn(async () => undefined) }));
vi.mock("../../lib/agent/llm", () => ({ generateReply: vi.fn(async () => ({ text: '{"reply":"Draft ready.","proposal":{"title":"Stitch check","instruction":"Ask whether the area around the stitches is red, hot or leaking."}}' })) }));

import { POST as inviteTeam } from "../../app/api/admin/team/route";
import { PATCH as patchPatient } from "../../app/api/admin/patients/[id]/route";
import { POST as prescribe } from "../../app/api/doctor/patients/[id]/medications/route";
import { GET as overview } from "../../app/api/doctor/overview/route";
import { GET as doctorAppointments } from "../../app/api/doctor/appointments/route";
import { PATCH as doctorAppt } from "../../app/api/doctor/appointments/[id]/route";
import { POST as refer } from "../../app/api/doctor/referrals/route";
import { PATCH as respondRefer } from "../../app/api/doctor/referrals/[id]/route";
import { POST as assistant } from "../../app/api/doctor/assistant/route";
import { POST as submitInstruction } from "../../app/api/doctor/instruction-requests/route";
import { PATCH as approve } from "../../app/api/admin/approvals/[id]/route";
import { dispatchToolCall } from "../../lib/agent/tools";
import { buildCarePlanContext } from "../../lib/agent/care-plan";
import { generateCallSummary, parseSummary } from "../../lib/agent/call-summary";
import { applyCallMedicationReports } from "../../lib/agent/adherence";

const OWNER = "owner-1";
const DOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const body = (url: string, method: string, b?: unknown) => new NextRequest(`http://localhost${url}`, { method, ...(b ? { body: JSON.stringify(b), headers: { "Content-Type": "application/json" } } : {}) });
const p = <T extends Record<string, string>>(x: T) => ({ params: Promise.resolve(x) });
const slot = (daysAhead: number, hour: number) => {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  return `${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d)}T${String(hour).padStart(2, "0")}:00:00+05:30`;
};

function seed() {
  const fake: any = createFakeDb({
    tenants: [{ id: "t1", auth_user_id: OWNER }],
    tenant_members: [{ tenant_id: "t1", user_id: OWNER, role: "hospital_admin" }],
    providers: [
      { id: DOC_A, tenant_id: "t1", user_id: null, name: "Dr. Anita Rao", status: "active", default_slot_minutes: 30, working_hours: null },
      { id: DOC_B, tenant_id: "t1", user_id: "docB-user", name: "Dr. Bhavesh Shah (cardio)", status: "active", default_slot_minutes: 30, working_hours: null },
    ],
    patients: [{ id: "pt1", clientId: OWNER, name: "Asha Verma", phone: "+919800000001", notes: "", riskLevel: "medium", doNotContact: false, createdAt: 1 }],
    appointments: [], alerts: [], referrals: [], medications: [], medication_adherence: [], agent_instruction_requests: [], session_logs: [], call_logs: [], follow_up_tasks: [],
  });
  fake.tables.tenant_members.push({ tenant_id: "t1", user_id: "docB-user", role: "clinician" });
  fake.rpc = async (name: string, a: Record<string, any>) => {
    if (name === "rate_limit_hit") return { data: { allowed: true }, error: null };
    const row = { id: `appt-${fake.tables.appointments.length + 1}`, tenant_id: a.p_tenant_id, client_id: a.p_client_id, provider_id: a.p_provider_id, patient_id: a.p_patient_id, starts_at: a.p_starts_at, ends_at: a.p_ends_at, visit_type: a.p_visit_type, status: "scheduled", notes: a.p_notes, booked_via: a.p_booked_via };
    fake.tables.appointments.push(row);
    return { data: row, error: null };
  };
  const users = [{ id: OWNER, email: "owner@h.test" }];
  fake.auth = { admin: { createUser: async (a: any) => { const u = { id: "docA-user", email: a.email }; users.push(u); return { data: { user: u }, error: null }; }, listUsers: async () => ({ data: { users }, error: null }), getUserById: async (id: string) => ({ data: { user: users.find((u) => u.id === id) ?? { id, email: `${id}@h.test` } }, error: null }), updateUserById: async () => ({ data: {}, error: null }) } };
  state.db = fake;
  return fake;
}

describe("user story: from admin setup to the next call", () => {
  beforeEach(() => { seed(); state.userId = null; });

  it("walks the whole flow", async () => {
    const db = state.db;

    // 1 ── Admin gives Dr. Rao her own login and assigns her patient.
    state.userId = OWNER;
    const invited = await (await inviteTeam(body("/api/admin/team", "POST", { email: "dr.rao@h.test", role: "clinician", providerId: DOC_A }))).json();
    expect(invited.member.tempPassword).toBeTruthy();
    expect((await patchPatient(body("/api/admin/patients/pt1", "PATCH", { primaryProviderId: DOC_A }), p({ id: "pt1" }))).status).toBe(200);

    // 2 ── Dr. Rao signs in (her own dashboard) and prescribes.
    state.userId = "docA-user";
    expect((await prescribe(body("/api/doctor/patients/pt1/medications", "POST", { name: "Metformin", dosage: "500 mg", frequency: "twice a day after food" }), p({ id: "pt1" }))).status).toBe(201);
    const medId = db.tables.medications[0].id;

    // 3 ── Last call: the patient reported back pain. The post-call summary captured it.
    const summary = parseSummary(JSON.stringify({ sentimentTrajectory: "worried", flaggedConcerns: ["back pain at night"], recommendedAction: "Check pain next call", followUpOutcome: "resolved", painReported: { present: true, location: "lower back", score: 6, description: "worse at night" } }));
    db.tables.call_logs.push({ id: "call-1", clientId: OWNER, patientId: "pt1", sessionId: "tel-1", status: "completed", startedAt: Date.now() - 3 * 86_400_000, endedAt: Date.now() - 3 * 86_400_000, summary });

    // 4 ── The next call's prompt: ask about that pain first, and about the medicine.
    const plan = await buildCarePlanContext(db, { clientId: OWNER, patientId: "pt1" });
    expect(plan).toContain("pain in the lower back, about 6/10");
    expect(plan).toMatch(/START this call by asking/);
    expect(plan).toContain(`Metformin 500 mg, twice a day after food — not asked yet [id=${medId}]`);

    // 5 ── Patient says she missed the tablet, on two calls → the doctor is flagged.
    const call = (sessionId: string) => ({ clientId: OWNER, sessionId, userId: "u", patientId: "pt1" });
    await dispatchToolCall("record_medication_adherence", { medicationId: medId, status: "missed", note: "felt sick" }, call("tel-2"));
    await dispatchToolCall("record_medication_adherence", { medicationId: medId, status: "missed" }, call("tel-3"));
    expect(db.tables.alerts.find((a: any) => a.id.startsWith("alert_adherence"))).toBeTruthy();
    const ov = await (await overview()).json();
    expect(ov.counts).toMatchObject({ patients: 1, adherenceRisks: 1 });
    expect(ov.adherenceRisks[0].medications[0]).toMatchObject({ name: "Metformin", missedStreak: 2 });

    // 6 ── A routine request is NOT booked; a genuinely serious one is.
    const log = (sessionId: string, text: string) => db.tables.session_logs.push({ sessionId, type: "utterance", ts: Date.now(), payload: { role: "user", text } });
    log("tel-4", "Can I get a check-up sometime next week?");
    const routine = JSON.parse(await dispatchToolCall("book_appointment", { providerId: DOC_A, startsAt: slot(3, 10), durationMinutes: 30, severity: "routine", clinicalReason: "check-up" }, call("tel-4")));
    expect(routine).toMatchObject({ success: false, declined: true });
    expect(db.tables.appointments).toHaveLength(0);

    log("tel-5", "The pain is unbearable and my leg is swollen");
    const serious = JSON.parse(await dispatchToolCall("book_appointment", { providerId: DOC_A, startsAt: slot(3, 11), durationMinutes: 30, severity: "serious", clinicalReason: "unbearable pain, swollen leg" }, call("tel-5")));
    expect(serious.success).toBe(true);
    // …and an older routine visit someone booked by hand lands on the same day.
    db.tables.appointments.push({ id: "old-routine", tenant_id: "t1", client_id: OWNER, provider_id: DOC_A, patient_id: "pt1", starts_at: new Date(Date.parse(slot(3, 14))).toISOString(), ends_at: new Date(Date.parse(slot(3, 14)) + 1_800_000).toISOString(), status: "scheduled", visit_type: "consultation", severity: "routine", priority_score: 20, booked_via: "staff" });

    // 7 ── The doctor's calendar ranks them; the unimportant one is flagged and she cancels it.
    const cal = (await (await doctorAppointments(body("/api/doctor/appointments", "GET"))).json()).appointments;
    const booked = cal.find((a: any) => a.booked_via === "ai_call");
    expect(booked).toMatchObject({ severity: "serious", lowPriority: false });
    const flagged = cal.find((a: any) => a.id === "old-routine");
    expect(flagged.lowPriority).toBe(true);
    const cancelled = await doctorAppt(body("/api/doctor/appointments/old-routine", "PATCH", { action: "cancel", reason: flagged.lowPriorityNote, notifyPatient: true }), p({ id: "old-routine" }));
    expect(cancelled.status).toBe(200);
    expect(db.tables.appointments.find((a: any) => a.id === "old-routine")).toMatchObject({ status: "cancelled", cancelled_by_role: "doctor" });
    expect(db.tables.appointments.find((a: any) => a.id === booked.id).status).toBe("scheduled");

    // 8 ── She refers the patient to the cardiologist, who accepts and can now see her.
    expect((await refer(body("/api/doctor/referrals", "POST", { patientId: "pt1", toProviderId: DOC_B, reason: "Leg swelling, please rule out a clot", urgency: "urgent" }))).status).toBe(201);
    state.userId = "docB-user";
    const refId = db.tables.referrals[0].id;
    expect((await respondRefer(body(`/api/doctor/referrals/${refId}`, "PATCH", { action: "accept", note: "Will see her Thursday" }), p({ id: refId }))).status).toBe(200);
    expect(db.tables.referrals[0].status).toBe("accepted");

    // 9 ── She asks the agent to check the stitches; the admin must approve it first.
    state.userId = "docA-user";
    const draft = await (await assistant(body("/api/doctor/assistant", "POST", { messages: [{ role: "doctor", content: "check the stitches each call" }], patientId: "pt1" }))).json();
    expect((await submitInstruction(body("/api/doctor/instruction-requests", "POST", { title: draft.proposal.title, doctorMessage: "check the stitches each call", proposedInstruction: draft.proposal.instruction, patientId: "pt1" }))).status).toBe(201);
    expect(await buildCarePlanContext(db, { clientId: OWNER, patientId: "pt1" })).not.toContain("red, hot or leaking");

    state.userId = OWNER;
    const reqId = db.tables.agent_instruction_requests[0].id;
    expect((await approve(body(`/api/admin/approvals/${reqId}`, "PATCH", { decision: "approved", note: "Good" }), p({ id: reqId }))).status).toBe(200);

    // 10 ── The next call carries all of it.
    const next = await buildCarePlanContext(db, { clientId: OWNER, patientId: "pt1" });
    expect(next).toContain("red, hot or leaking");
    expect(next).toContain("Dr. Anita Rao:");
    expect(next).toContain("last reported: missed");
  });

  it("the post-call summary feeds the next call: pain in, adherence in", async () => {
    const db = state.db;
    state.userId = "docA-user";
    db.tables.patients[0].primaryProviderId = DOC_A;
    db.tables.tenant_members.push({ tenant_id: "t1", user_id: "docA-user", role: "clinician" });
    db.tables.providers[0].user_id = "docA-user";
    await prescribe(body("/api/doctor/patients/pt1/medications", "POST", { name: "Amlodipine", frequency: "daily" }), p({ id: "pt1" }));
    const medId = db.tables.medications[0].id;
    const parsed = parseSummary(JSON.stringify({ sentimentTrajectory: "calm", flaggedConcerns: [], recommendedAction: "ok", followUpOutcome: "resolved", painReported: { present: true, location: "chest", score: 3, description: "mild" }, medicationReports: [{ medicationId: medId, status: "partial", note: "forgot evening" }] }), new Set([medId]))!;
    await applyCallMedicationReports(db, { clientId: OWNER, patientId: "pt1", sessionId: "tel-9", reports: parsed.medicationReports });
    db.tables.call_logs.push({ id: "c9", clientId: OWNER, patientId: "pt1", startedAt: Date.now() - 86_400_000, endedAt: Date.now() - 86_400_000, summary: parsed });
    const plan = await buildCarePlanContext(db, { clientId: OWNER, patientId: "pt1" });
    expect(plan).toContain("pain in the chest, about 3/10");
    expect(plan).toContain("last reported: partial");
    expect(generateCallSummary).toBeTypeOf("function");
  });
});
