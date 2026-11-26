import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeDb } from "../helpers/fake-supabase";

/**
 * The real route handlers, signed in as each role, against one in-memory hospital. Proves the server — not the menu —
 * is what keeps each role in its lane, and that a doctor only ever reaches their own patients and calendar.
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
vi.mock("../../lib/scheduler/appointment-reminders", () => ({
  scheduleAppointmentReminders: vi.fn(async () => undefined),
  cancelAppointmentReminders: vi.fn(async () => undefined),
  triggerWaitlistBackfill: vi.fn(async () => undefined),
}));
vi.mock("../../lib/telephony/sms", () => ({ sendSMS: vi.fn(async () => undefined) }));
vi.mock("../../lib/agent/llm", () => ({ generateReply: vi.fn(async () => ({ text: '{"reply":"Here is a draft.","proposal":{"title":"Wound check","instruction":"Ask whether the wound is red or leaking, each call."}}' })) }));

import { GET as listPatients, POST as createPatient } from "../../app/api/admin/patients/route";
import { DELETE as cancelAppt } from "../../app/api/admin/appointments/[id]/route";
import { PATCH as resolveAlert } from "../../app/api/alerts/[id]/route";
import { GET as getAlerts } from "../../app/api/alerts/route";
import { GET as getTeam, POST as inviteTeam } from "../../app/api/admin/team/route";
import { GET as getApprovals } from "../../app/api/admin/approvals/route";
import { PATCH as reviewApproval } from "../../app/api/admin/approvals/[id]/route";
import { PATCH as patchProvider } from "../../app/api/admin/providers/[id]/route";
import { GET as doctorPatients } from "../../app/api/doctor/patients/route";
import { GET as doctorPatient } from "../../app/api/doctor/patients/[id]/route";
import { GET as doctorOverview } from "../../app/api/doctor/overview/route";
import { PATCH as doctorAppt } from "../../app/api/doctor/appointments/[id]/route";
import { POST as doctorRefer } from "../../app/api/doctor/referrals/route";
import { POST as doctorAssistant } from "../../app/api/doctor/assistant/route";
import { POST as doctorSubmit } from "../../app/api/doctor/instruction-requests/route";
import { POST as doctorMeds } from "../../app/api/doctor/patients/[id]/medications/route";

const OWNER = "owner-1";
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

function seed() {
  const fake: any = createFakeDb({
    tenants: [{ id: "t1", auth_user_id: OWNER }],
    tenant_members: [
      { tenant_id: "t1", user_id: OWNER, role: "hospital_admin" },
      { tenant_id: "t1", user_id: "docA-user", role: "clinician" },
      { tenant_id: "t1", user_id: "docB-user", role: "clinician" },
      { tenant_id: "t1", user_id: "coord-user", role: "care_coordinator" },
      { tenant_id: "t1", user_id: "audit-user", role: "auditor" },
    ],
    providers: [
      { id: "11111111-1111-4111-8111-111111111111", tenant_id: "t1", user_id: "docA-user", name: "Dr. A", status: "active" },
      { id: "22222222-2222-4222-8222-222222222222", tenant_id: "t1", user_id: "docB-user", name: "Dr. B", status: "active" },
    ],
    patients: [
      { id: "ptA", clientId: OWNER, name: "Asha", phone: "+911", notes: "", riskLevel: "high", primaryProviderId: "11111111-1111-4111-8111-111111111111", createdAt: 1 },
      { id: "ptB", clientId: OWNER, name: "Bala", phone: "+912", notes: "", riskLevel: "low", primaryProviderId: "22222222-2222-4222-8222-222222222222", createdAt: 2 },
    ],
    appointments: [
      { id: "apptA", tenant_id: "t1", client_id: OWNER, provider_id: "11111111-1111-4111-8111-111111111111", patient_id: "ptA", starts_at: future(2), ends_at: future(2), status: "scheduled", visit_type: "consultation", severity: "routine", priority_score: 20 },
      { id: "apptB", tenant_id: "t1", client_id: OWNER, provider_id: "22222222-2222-4222-8222-222222222222", patient_id: "ptB", starts_at: future(2), ends_at: future(2), status: "scheduled", visit_type: "consultation" },
    ],
    alerts: [{ id: "alA", clientId: OWNER, patientId: "ptA", reason: "Pain", priority: "high", status: "open", createdAt: 1 }, { id: "alB", clientId: OWNER, patientId: "ptB", reason: "Other", priority: "low", status: "open", createdAt: 2 }],
    referrals: [], medications: [], medication_adherence: [], agent_instruction_requests: [], call_logs: [], follow_up_tasks: [],
  });
  fake.rpc = async () => ({ data: { allowed: true }, error: null });
  fake.auth = { admin: { createUser: async (a: any) => ({ data: { user: { id: "new-user", email: a.email } }, error: null }), listUsers: async () => ({ data: { users: [{ id: OWNER, email: "owner@h.test" }] }, error: null }), getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@h.test` } }, error: null }), updateUserById: async () => ({ data: {}, error: null }) } };
  state.db = fake;
  return fake;
}

const asUser = (id: string | null) => { state.userId = id; };
const req = (url: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost${url}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => { seed(); asUser(null); });

describe("signed out", () => {
  it("is refused everywhere", async () => {
    expect((await listPatients()).status).toBe(401);
    expect((await getTeam()).status).toBe(401);
    expect((await doctorOverview()).status).toBe(401);
    expect((await doctorPatients()).status).toBe(401);
  });
});

describe("hospital admin", () => {
  it("manages the hospital; the doctor portal is not theirs", async () => {
    asUser(OWNER);
    expect((await listPatients()).status).toBe(200);
    expect((await getTeam()).status).toBe(200);
    expect((await getApprovals(req("/api/admin/approvals"))).status).toBe(200);
    expect((await doctorOverview()).status).toBe(403);
  });
});

describe("care coordinator", () => {
  it("works patients, appointments and alerts…", async () => {
    asUser("coord-user");
    expect(((await (await listPatients()).json()).patients as unknown[]).length).toBe(2);
    expect((await getAlerts(req("/api/alerts"))).status).toBe(200);
    expect((await cancelAppt(req("/api/admin/appointments/apptB", "DELETE", { reason: "patient asked" }), params({ id: "apptB" }))).status).toBe(200);
    expect(state.db.tables.appointments.find((a: any) => a.id === "apptB").status).toBe("cancelled");
    expect((await resolveAlert(req("/api/alerts/alB", "PATCH", {}), params({ id: "alB" }))).status).toBe(200);
  });

  it("…but not the team, approvals, doctor profiles or the doctor portal", async () => {
    asUser("coord-user");
    expect((await getTeam()).status).toBe(403);
    expect((await inviteTeam(req("/api/admin/team", "POST", { email: "x@h.test", role: "auditor" }))).status).toBe(403);
    expect((await getApprovals(req("/api/admin/approvals"))).status).toBe(403);
    expect((await patchProvider(req(`/api/admin/providers/${A}`, "PATCH", { name: "Renamed" }), params({ id: A }))).status).toBe(403);
    expect((await doctorOverview()).status).toBe(403);
  });
});

describe("auditor", () => {
  it("reads but never writes", async () => {
    asUser("audit-user");
    expect((await listPatients()).status).toBe(200);
    expect((await getAlerts(req("/api/alerts"))).status).toBe(200);
    const form = new FormData(); form.set("name", "New"); form.set("phone", "+9199"); form.set("notes", "n");
    expect((await createPatient(new NextRequest("http://localhost/api/admin/patients", { method: "POST", body: form }))).status).toBe(403);
    expect((await cancelAppt(req("/api/admin/appointments/apptA", "DELETE", {}), params({ id: "apptA" }))).status).toBe(403);
    expect((await resolveAlert(req("/api/alerts/alA", "PATCH", {}), params({ id: "alA" }))).status).toBe(403);
    expect(state.db.tables.appointments.find((a: any) => a.id === "apptA").status).toBe("scheduled");
  });
});

describe("a doctor", () => {
  it("is shut out of every admin API", async () => {
    asUser("docA-user");
    expect((await listPatients()).status).toBe(403);
    expect((await getAlerts(req("/api/alerts"))).status).toBe(403);
    expect((await getTeam()).status).toBe(403);
    expect((await getApprovals(req("/api/admin/approvals"))).status).toBe(403);
    expect((await cancelAppt(req("/api/admin/appointments/apptA", "DELETE", {}), params({ id: "apptA" }))).status).toBe(403);
  });

  it("sees only their own patients", async () => {
    asUser("docA-user");
    const body = await (await doctorPatients()).json();
    expect(body.patients.map((p: any) => p.name)).toEqual(["Asha"]);
    asUser("docB-user");
    expect((await (await doctorPatients()).json()).patients.map((p: any) => p.name)).toEqual(["Bala"]);
  });

  it("gets a 404 — not a 403 — for another doctor's patient", async () => {
    asUser("docA-user");
    expect((await doctorPatient(req("/api/doctor/patients/ptA"), params({ id: "ptA" }))).status).toBe(200);
    expect((await doctorPatient(req("/api/doctor/patients/ptB"), params({ id: "ptB" }))).status).toBe(404);
    expect((await doctorMeds(req("/api/doctor/patients/ptB/medications", "POST", { name: "Aspirin" }), params({ id: "ptB" }))).status).toBe(404);
  });

  it("prescribes to their own patient", async () => {
    asUser("docA-user");
    const res = await doctorMeds(req("/api/doctor/patients/ptA/medications", "POST", { name: "Metformin", dosage: "500 mg", frequency: "twice a day" }), params({ id: "ptA" }));
    expect(res.status).toBe(201);
    expect(state.db.tables.medications[0]).toMatchObject({ patientId: "ptA", providerId: A, clientId: OWNER, name: "Metformin" });
  });

  it("cancels only an appointment on their own calendar, and must give a reason", async () => {
    asUser("docA-user");
    expect((await doctorAppt(req("/api/doctor/appointments/apptB", "PATCH", { action: "cancel", reason: "not important" }), params({ id: "apptB" }))).status).toBe(404);
    expect(state.db.tables.appointments.find((a: any) => a.id === "apptB").status).toBe("scheduled");
    expect((await doctorAppt(req("/api/doctor/appointments/apptA", "PATCH", { action: "cancel", reason: "" }), params({ id: "apptA" }))).status).toBe(400);
    const ok = await doctorAppt(req("/api/doctor/appointments/apptA", "PATCH", { action: "cancel", reason: "Routine; room for a sicker patient", notifyPatient: true }), params({ id: "apptA" }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).patientNotified).toBe(true);
    expect(state.db.tables.appointments.find((a: any) => a.id === "apptA")).toMatchObject({ status: "cancelled", cancelled_by_role: "doctor", cancelled_by_user_id: "docA-user" });
    expect((await doctorAppt(req("/api/doctor/appointments/apptA", "PATCH", { action: "cancel", reason: "again please" }), params({ id: "apptA" }))).status).toBe(409);
  });

  it("refers their own patient to a colleague, never someone else's patient", async () => {
    asUser("docA-user");
    expect((await doctorRefer(req("/api/doctor/referrals", "POST", { patientId: "ptB", toProviderId: B, reason: "Needs cardiology" }))).status).toBe(404);
    const ok = await doctorRefer(req("/api/doctor/referrals", "POST", { patientId: "ptA", toProviderId: B, reason: "Needs cardiology review" }));
    expect(ok.status).toBe(201);
    asUser("docB-user");
    expect((await doctorPatient(req("/api/doctor/patients/ptA"), params({ id: "ptA" }))).status).toBe(200);
  });

  it("drafts an instruction with the assistant and submits it — pending, and checked again on the server", async () => {
    asUser("docA-user");
    const chat = await doctorAssistant(req("/api/doctor/assistant", "POST", { messages: [{ role: "doctor", content: "Ask about the wound" }], patientId: "ptA" }));
    expect(chat.status).toBe(200);
    expect((await chat.json()).proposal.instruction).toMatch(/wound/);

    expect((await doctorAssistant(req("/api/doctor/assistant", "POST", { messages: [{ role: "doctor", content: "x" }], patientId: "ptB" }))).status).toBe(404);

    const bad = await doctorSubmit(req("/api/doctor/instruction-requests", "POST", { title: "Dose", doctorMessage: "double it", proposedInstruction: "Tell the patient to double the dose", patientId: "ptA" }));
    expect(bad.status).toBe(400);
    const ok = await doctorSubmit(req("/api/doctor/instruction-requests", "POST", { title: "Wound check", doctorMessage: "ask about the wound", proposedInstruction: "Ask whether the wound is red or leaking, each call.", patientId: "ptA" }));
    expect(ok.status).toBe(201);
    expect(state.db.tables.agent_instruction_requests[0]).toMatchObject({ status: "pending", provider_id: A, patientId: "ptA" });
  });

  it("cannot approve their own request — only an admin can", async () => {
    asUser("docA-user");
    await doctorSubmit(req("/api/doctor/instruction-requests", "POST", { title: "Wound check", doctorMessage: "ask", proposedInstruction: "Ask whether the wound is red or leaking, each call.", patientId: "ptA" }));
    const id = state.db.tables.agent_instruction_requests[0].id;
    expect((await reviewApproval(req(`/api/admin/approvals/${id}`, "PATCH", { decision: "approved" }), params({ id }))).status).toBe(403);
    asUser("coord-user");
    expect((await reviewApproval(req(`/api/admin/approvals/${id}`, "PATCH", { decision: "approved" }), params({ id }))).status).toBe(403);
    asUser(OWNER);
    expect((await reviewApproval(req(`/api/admin/approvals/${id}`, "PATCH", { decision: "approved" }), params({ id }))).status).toBe(200);
    expect(state.db.tables.agent_instruction_requests[0].status).toBe("approved");
  });
});

describe("admin creates a doctor's login", () => {
  it("returns a one-time password and links the doctor", async () => {
    asUser(OWNER);
    state.db.tables.providers.push({ id: "33333333-3333-4333-8333-333333333333", tenant_id: "t1", user_id: null, name: "Dr. New", status: "active" });
    const res = await inviteTeam(req("/api/admin/team", "POST", { email: "dr.new@h.test", role: "clinician", providerId: "33333333-3333-4333-8333-333333333333" }));
    expect(res.status).toBe(201);
    const { member } = await res.json();
    expect(member.tempPassword).toHaveLength(14);
    expect(state.db.tables.providers.find((p: any) => p.name === "Dr. New").user_id).toBe("new-user");
    expect(state.db.tables.tenant_members.find((m: any) => m.user_id === "new-user").role).toBe("clinician");
  });
});
