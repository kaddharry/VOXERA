import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "../helpers/fake-supabase";

vi.mock("../../lib/scheduler/appointment-reminders", () => ({
  scheduleAppointmentReminders: vi.fn(async () => undefined),
  cancelAppointmentReminders: vi.fn(async () => undefined),
  triggerWaitlistBackfill: vi.fn(async () => undefined),
}));
const sms = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../lib/telephony/sms", () => ({ sendSMS: sms }));

import { flagLowPriority, getDoctorOverview, getMyAppointment, getMyPatient, getPatientDetailForDoctor, isMyPatient, listMyAppointments, listMyPatients, myPatientIds } from "../../lib/db/doctor";
import { cancelAppointmentFully } from "../../lib/db/appointment-cancel";
import { cancelAppointmentReminders, triggerWaitlistBackfill } from "../../lib/scheduler/appointment-reminders";

const A = { clientId: "c", tenantId: "t1", providerId: "docA" };
const B = { clientId: "c", tenantId: "t1", providerId: "docB" };
const day = (d: number, h = 10) => new Date(Date.UTC(2026, 11, d, h)).toISOString();

function seed() {
  return createFakeDb({
    patients: [
      { id: "ptA", clientId: "c", name: "Asha (A's)", phone: "+91111", riskLevel: "high", primaryProviderId: "docA", condition: "Post-op" },
      { id: "ptB", clientId: "c", name: "Bala (B's)", phone: "+91222", riskLevel: "low", primaryProviderId: "docB" },
      { id: "ptApt", clientId: "c", name: "Chitra (seen by A)", phone: "+91333", riskLevel: "low", primaryProviderId: null },
      { id: "ptRef", clientId: "c", name: "Dev (referred to A)", phone: "+91444", riskLevel: "medium", primaryProviderId: "docB" },
      { id: "ptDeclined", clientId: "c", name: "Esha (declined by A)", phone: "+91555", riskLevel: "low", primaryProviderId: "docB" },
      { id: "ptOther", clientId: "other", name: "Other hospital", phone: "+91666", riskLevel: "low", primaryProviderId: "docA" },
    ],
    appointments: [
      { id: "a1", client_id: "c", provider_id: "docA", patient_id: "ptApt", starts_at: day(10), ends_at: day(10, 11), status: "scheduled", visit_type: "follow_up", severity: "routine", priority_score: 20, booked_via: "ai_call" },
      { id: "a2", client_id: "c", provider_id: "docA", patient_id: "ptA", starts_at: day(10, 12), ends_at: day(10, 13), status: "scheduled", visit_type: "consultation", severity: "serious", priority_score: 86, booked_via: "ai_call" },
      { id: "a3", client_id: "c", provider_id: "docB", patient_id: "ptB", starts_at: day(10, 10), ends_at: day(10, 11), status: "scheduled", visit_type: "consultation", severity: "routine", priority_score: 20 },
      { id: "a4", client_id: "c", provider_id: "docA", patient_id: "ptA", starts_at: day(12), ends_at: day(12, 11), status: "scheduled", visit_type: "consultation" /* pre-migration row: no severity */ },
    ],
    referrals: [
      { id: "r1", clientId: "c", patientId: "ptRef", from_provider_id: "docB", to_provider_id: "docA", status: "pending" },
      { id: "r2", clientId: "c", patientId: "ptDeclined", from_provider_id: "docB", to_provider_id: "docA", status: "declined" },
    ],
    alerts: [
      { id: "al1", clientId: "c", patientId: "ptA", reason: "Caller in pain", priority: "high", status: "open", createdAt: 1 },
      { id: "al2", clientId: "c", patientId: "ptB", reason: "B's alert", priority: "high", status: "open", createdAt: 2 },
    ],
    providers: [{ id: "docA", name: "Dr. A" }, { id: "docB", name: "Dr. B" }],
    call_logs: [], medications: [], medication_adherence: [], agent_instruction_requests: [],
  });
}

describe("'my patients' — the one rule behind everything a doctor sees", () => {
  it("is primary patients + patients with my appointments + patients referred to me (not declined)", async () => {
    const ids = await myPatientIds(seed() as never, A);
    expect([...ids.keys()].sort()).toEqual(["ptA", "ptApt", "ptRef"]);
    expect(ids.get("ptA")).toBe("primary");
    expect(ids.get("ptApt")).toBe("appointment");
    expect(ids.get("ptRef")).toBe("referral");
  });

  it("gives doctor B a completely different list", async () => {
    const ids = await myPatientIds(seed() as never, B);
    expect([...ids.keys()].sort()).toEqual(["ptB", "ptDeclined", "ptRef"]);
  });

  it("never exposes another doctor's patient, another hospital's patient, or a declined referral", async () => {
    const db = seed() as never;
    expect(await isMyPatient(db, A, "ptB")).toBe(false);
    expect(await isMyPatient(db, A, "ptOther")).toBe(false);
    expect(await isMyPatient(db, A, "ptDeclined")).toBe(false);
    expect(await getMyPatient(db, A, "ptB")).toBeNull();
    expect(await getPatientDetailForDoctor(db, A, "ptB")).toBeNull();
    expect((await listMyPatients(db, A)).map((p) => p.name)).toEqual(["Asha (A's)", "Chitra (seen by A)", "Dev (referred to A)"]);
  });
});

describe("the doctor's calendar", () => {
  it("shows only my appointments, with patient names and defaults for rows saved before severity existed", async () => {
    const list = await listMyAppointments(seed() as never, A, { from: day(1), to: day(30) });
    expect(list.map((a) => a.id)).toEqual(["a1", "a2", "a4"]);
    expect(list[0].patientName).toBe("Chitra (seen by A)");
    expect(list[2]).toMatchObject({ severity: "routine", priority_score: 20 });
  });

  it("flags a low-priority visit only when a clearly more important one shares its day", async () => {
    const list = await listMyAppointments(seed() as never, A, { from: day(1), to: day(30) });
    const flagged = list.filter((a) => a.lowPriority).map((a) => a.id);
    expect(flagged).toEqual(["a1"]); // a4 is routine too but alone on its day
    expect(list.find((a) => a.id === "a1")!.lowPriorityNote).toMatch(/Routine visit; 1 more important patient is booked the same day/);
  });

  it("flagLowPriority ignores finished and cancelled visits and never flags the important one", () => {
    const f = flagLowPriority([
      { id: "x", starts_at: day(5), priority_score: 20, status: "scheduled", severity: "routine" },
      { id: "y", starts_at: day(5, 14), priority_score: 85, status: "scheduled", severity: "serious" },
      { id: "z", starts_at: day(5, 16), priority_score: 90, status: "cancelled", severity: "emergency" },
    ]);
    expect([...f.keys()]).toEqual(["x"]);
    expect(flagLowPriority([{ id: "x", starts_at: day(5), priority_score: 20, status: "scheduled", severity: "routine" }, { id: "z", starts_at: day(5, 16), priority_score: 90, status: "cancelled", severity: "emergency" }]).size).toBe(0);
  });

  it("only finds an appointment on my own calendar", async () => {
    const db = seed() as never;
    expect(await getMyAppointment(db, A, "a1")).not.toBeNull();
    expect(await getMyAppointment(db, A, "a3")).toBeNull();
    expect(await getMyAppointment(db, B, "a1")).toBeNull();
  });
});

describe("cancelling an appointment that doesn't matter", () => {
  it("cancels, records who and why, removes reminders, offers the slot to the waitlist and texts the patient", async () => {
    const db = seed();
    const r = await cancelAppointmentFully(db as never, { appointmentId: "a1", clientId: "c", reason: "Routine; room for a sicker patient", actor: { userId: "u-docA", role: "doctor" }, notifyPatient: true, doctorName: "Dr. A" });
    expect(r?.appointment.status).toBe("cancelled");
    expect(r?.notified).toBe(true);
    const row = db.tables.appointments.find((a) => a.id === "a1")!;
    expect(row).toMatchObject({ status: "cancelled", cancel_reason: "Routine; room for a sicker patient", cancelled_by_user_id: "u-docA", cancelled_by_role: "doctor" });
    expect(cancelAppointmentReminders).toHaveBeenCalledTimes(1);
    expect(triggerWaitlistBackfill).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerId: "docA", clientId: "c" }));
    expect(sms).toHaveBeenCalledTimes(1);
    const body = (sms.mock.calls[0] as unknown as [{ to: string; body: string }])[0];
    expect(body.to).toBe("+91333");
    expect(body.body).toMatch(/cancelled/);
    expect(body.body).not.toMatch(/Routine; room for a sicker patient/); // the reason stays internal
  });

  it("doesn't text a patient who asked not to be contacted, or when told not to", async () => {
    sms.mockClear();
    const db = seed();
    db.tables.patients.find((p) => p.id === "ptApt")!.doNotContact = true;
    const r = await cancelAppointmentFully(db as never, { appointmentId: "a1", clientId: "c", reason: "x y z", actor: { userId: null, role: "doctor" }, notifyPatient: true });
    expect(r?.notified).toBe(false);
    const r2 = await cancelAppointmentFully(seed() as never, { appointmentId: "a2", clientId: "c", reason: "x y z", actor: { userId: null, role: "doctor" }, notifyPatient: false });
    expect(r2?.notified).toBe(false);
    expect(sms).not.toHaveBeenCalled();
  });

  it("can't cancel another hospital's appointment", async () => {
    expect(await cancelAppointmentFully(seed() as never, { appointmentId: "a1", clientId: "other", reason: "x y z", actor: { userId: null, role: "doctor" } })).toBeNull();
  });
});

describe("patient detail and overview", () => {
  it("builds the detail page from the doctor's own data: pain history, adherence, alerts, my appointments only", async () => {
    const db = seed();
    db.tables.call_logs.push(
      { id: "c1", clientId: "c", patientId: "ptA", startedAt: 100, status: "completed", summary: { recommendedAction: "Review", flaggedConcerns: ["swelling"], painReported: { present: true, location: "knee", score: 6, description: "after walking" } } },
      { id: "c2", clientId: "c", patientId: "ptA", startedAt: 200, status: "completed", summary: { painReported: { present: true, location: "knee", score: 4, description: null } } },
    );
    db.tables.medications.push({ id: "m1", clientId: "c", patientId: "ptA", name: "Ibuprofen", status: "active", frequency: "daily", timesPerDay: 1, startDate: 0, createdAt: 0, updatedAt: 0 });
    db.tables.medication_adherence.push({ id: "x1", clientId: "c", patientId: "ptA", medicationId: "m1", status: "missed", reportedAt: Date.now() - 1000, sessionId: "s1", source: "call" }, { id: "x2", clientId: "c", patientId: "ptA", medicationId: "m1", status: "missed", reportedAt: Date.now() - 500, sessionId: "s2", source: "call" });
    const d = await getPatientDetailForDoctor(db as never, A, "ptA");
    expect(d!.patient.name).toBe("Asha (A's)");
    expect(d!.pain.map((p) => p.score)).toEqual([6, 4]);
    expect(d!.calls[0].summary?.painReported?.location).toBe("knee");
    expect(d!.adherence.atRisk).toBe(true);
    expect(d!.alerts.map((a) => a.id)).toEqual(["al1"]);
    expect(d!.appointments.every((a) => a.provider_id === "docA")).toBe(true);
  });

  it("summarises the day: counts, alerts only for my patients, medication at risk, pending referrals", async () => {
    const db = seed();
    db.tables.medications.push({ id: "m1", clientId: "c", patientId: "ptA", name: "Ibuprofen", status: "active", frequency: "daily", timesPerDay: 1, startDate: 0, createdAt: 0, updatedAt: 0 });
    db.tables.medication_adherence.push({ id: "x1", clientId: "c", patientId: "ptA", medicationId: "m1", status: "missed", reportedAt: Date.now() - 1000, sessionId: "s1", source: "call" }, { id: "x2", clientId: "c", patientId: "ptA", medicationId: "m1", status: "missed", reportedAt: Date.now() - 500, sessionId: "s2", source: "call" });
    const o = await getDoctorOverview(db as never, A, new Date(Date.UTC(2026, 11, 10, 8)));
    expect(o.counts).toMatchObject({ patients: 3, today: 2, thisWeek: 3, openAlerts: 1, adherenceRisks: 1, pendingReferrals: 1, lowPriority: 1 });
    expect(o.alerts.map((a) => a.patientName)).toEqual(["Asha (A's)"]);
    expect(o.adherenceRisks[0]).toMatchObject({ patientName: "Asha (A's)" });
  });
});
