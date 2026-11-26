import { describe, expect, it } from "vitest";
import { applyCallMedicationReports, recordAdherenceAndCheck } from "../../lib/agent/adherence";
import { addMedication, computeAdherence, listAdherence, listMedications, recordAdherence, setMedicationStatus, type AdherenceRecord, type MedicationRecord } from "../../lib/db/medications";
import { MEDICATION_HINT, isMedicationTurn } from "../../lib/agent/booking-intent";
import { createFakeDb } from "../helpers/fake-supabase";

const T0 = Date.UTC(2026, 10, 20);
const med = (over: Partial<MedicationRecord> = {}): MedicationRecord => ({ id: "m1", clientId: "c", patientId: "p1", providerId: null, name: "Metformin", dosage: null, frequency: "daily", timesPerDay: 1, instructions: null, startDate: 0, endDate: null, status: "active", createdAt: 0, updatedAt: 0, ...over });
const log = (status: AdherenceRecord["status"], day: number, medicationId = "m1"): AdherenceRecord => ({ id: `${medicationId}-${day}`, clientId: "c", patientId: "p1", medicationId, sessionId: `s${day}`, status, note: null, source: "call", reportedAt: T0 + day * 86_400_000 });

describe("computeAdherence", () => {
  it("is null until something is reported", () => {
    const r = computeAdherence([med()], []);
    expect(r.overallPct).toBeNull();
    expect(r.atRisk).toBe(false);
    expect(r.medications[0]).toMatchObject({ adherencePct: null, reports: 0, lastStatus: null });
  });

  it("counts taken as 1, partial as half, missed as 0 and ignores 'unknown'", () => {
    const r = computeAdherence([med()], [log("taken", 1), log("partial", 2), log("missed", 3), log("unknown", 4)]);
    expect(r.medications[0]).toMatchObject({ reports: 3, taken: 1, partial: 1, missed: 1, adherencePct: 50 });
  });

  it("flags two misses in a row, however good the earlier record was", () => {
    const r = computeAdherence([med()], [log("taken", 1), log("taken", 2), log("taken", 3), log("missed", 4), log("missed", 5)]);
    expect(r.medications[0]).toMatchObject({ missedStreak: 2, atRisk: true, lastStatus: "missed" });
    expect(r.atRisk).toBe(true);
  });

  it("flags low adherence over at least three reports, but not on one or two", () => {
    expect(computeAdherence([med()], [log("missed", 1), log("taken", 2)]).atRisk).toBe(false);
    expect(computeAdherence([med()], [log("missed", 1), log("taken", 2), log("missed", 3), log("taken", 4), log("missed", 5)]).medications[0].atRisk).toBe(true);
  });

  it("a taken dose breaks the missed streak", () => {
    expect(computeAdherence([med()], [log("missed", 1), log("missed", 2), log("taken", 3)]).medications[0].missedStreak).toBe(0);
  });

  it("only scores active medicines, and weights the overall figure by reports", () => {
    const r = computeAdherence([med(), med({ id: "m2", name: "Stopped", status: "stopped" }), med({ id: "m3", name: "Amlodipine" })], [log("taken", 1), log("taken", 2), log("missed", 1, "m3"), log("taken", 9, "m2")]);
    expect(r.medications.map((m) => m.name)).toEqual(["Metformin", "Amlodipine"]);
    expect(r.overallPct).toBe(67);
  });
});

describe("recording what the patient said", () => {
  const seed = () =>
    createFakeDb({
      patients: [{ id: "p1", clientId: "c" }, { id: "p2", clientId: "c" }],
      medications: [
        { id: "m1", clientId: "c", patientId: "p1", name: "Metformin", status: "active", frequency: "daily", timesPerDay: 1, startDate: 0, createdAt: 0, updatedAt: 0 },
        { id: "mx", clientId: "c", patientId: "p2", name: "Someone else's", status: "active", frequency: "daily", timesPerDay: 1, startDate: 0, createdAt: 0, updatedAt: 0 },
        { id: "mo", clientId: "other", patientId: "p1", name: "Other hospital", status: "active", frequency: "daily", timesPerDay: 1, startDate: 0, createdAt: 0, updatedAt: 0 },
      ],
    });

  it("never trusts a model-supplied id: another patient's or another hospital's medicine is refused", async () => {
    const db = seed();
    expect(await recordAdherence(db as never, { clientId: "c", patientId: "p1", medicationId: "mx", status: "taken" })).toBeNull();
    expect(await recordAdherence(db as never, { clientId: "c", patientId: "p1", medicationId: "mo", status: "taken" })).toBeNull();
    expect(await recordAdherence(db as never, { clientId: "c", patientId: "p1", medicationId: "nope", status: "taken" })).toBeNull();
    expect(db.tables.medication_adherence ?? []).toHaveLength(0);
  });

  it("keeps ONE answer per medicine per call: asking again corrects it instead of double counting", async () => {
    const db = seed();
    await recordAdherence(db as never, { clientId: "c", patientId: "p1", medicationId: "m1", status: "missed", sessionId: "s1" });
    await recordAdherence(db as never, { clientId: "c", patientId: "p1", medicationId: "m1", status: "taken", sessionId: "s1", note: "actually took it" });
    expect(db.tables.medication_adherence).toHaveLength(1);
    expect(db.tables.medication_adherence[0]).toMatchObject({ status: "taken", note: "actually took it" });
    await recordAdherence(db as never, { clientId: "c", patientId: "p1", medicationId: "m1", status: "taken", sessionId: "s2" });
    expect(db.tables.medication_adherence).toHaveLength(2);
  });

  it("raises one alert for the doctor after repeated misses, and not before", async () => {
    const db = seed();
    const first = await recordAdherenceAndCheck(db as never, { clientId: "c", patientId: "p1", medicationId: "m1", status: "missed", sessionId: "s1" });
    expect(first).toMatchObject({ atRisk: false });
    expect(db.tables.alerts ?? []).toHaveLength(0);

    const second = await recordAdherenceAndCheck(db as never, { clientId: "c", patientId: "p1", medicationId: "m1", status: "missed", sessionId: "s2" });
    expect(second).toMatchObject({ atRisk: true });
    expect(db.tables.alerts).toHaveLength(1);
    expect(db.tables.alerts[0]).toMatchObject({ id: "alert_adherence_p1_m1", patientId: "p1", priority: "normal" });
    expect(db.tables.alerts[0].reason).toMatch(/Metformin — missed 2 reports in a row/);

    await recordAdherenceAndCheck(db as never, { clientId: "c", patientId: "p1", medicationId: "m1", status: "missed", sessionId: "s3" });
    expect(db.tables.alerts).toHaveLength(1);
  });

  it("re-opens a resolved alert when the pattern continues", async () => {
    const db = seed();
    for (const s of ["s1", "s2"]) await recordAdherenceAndCheck(db as never, { clientId: "c", patientId: "p1", medicationId: "m1", status: "missed", sessionId: s });
    db.tables.alerts[0].status = "resolved";
    await recordAdherenceAndCheck(db as never, { clientId: "c", patientId: "p1", medicationId: "m1", status: "missed", sessionId: "s3" });
    expect(db.tables.alerts[0].status).toBe("open");
  });

  it("applies the post-call summary's findings but never overrides what the agent recorded live", async () => {
    const db = seed();
    await recordAdherenceAndCheck(db as never, { clientId: "c", patientId: "p1", medicationId: "m1", status: "taken", sessionId: "s1" });
    const applied = await applyCallMedicationReports(db as never, { clientId: "c", patientId: "p1", sessionId: "s1", reports: [{ medicationId: "m1", status: "missed", note: null }] });
    expect(applied).toBe(0);
    expect(db.tables.medication_adherence[0].status).toBe("taken");

    const later = await applyCallMedicationReports(db as never, { clientId: "c", patientId: "p1", sessionId: "s2", reports: [{ medicationId: "m1", status: "partial", note: "forgot evening dose" }] });
    expect(later).toBe(1);
    expect(db.tables.medication_adherence.find((r) => r.sessionId === "s2")).toMatchObject({ status: "partial", source: "call" });
  });
});

describe("prescribing", () => {
  it("adds, lists and stops a medicine, scoped to the hospital", async () => {
    const db = createFakeDb({ patients: [{ id: "p1" }] });
    const added = await addMedication(db as never, "c", "p1", "doc1", { name: " Atorvastatin ", dosage: "10 mg", frequency: "at night", timesPerDay: 9 });
    expect(added).toMatchObject({ name: "Atorvastatin", dosage: "10 mg", frequency: "at night", timesPerDay: 6, status: "active", providerId: "doc1" });
    expect(await listMedications(db as never, "c", "p1", { activeOnly: true })).toHaveLength(1);
    expect(await listMedications(db as never, "other", "p1")).toHaveLength(0);

    await setMedicationStatus(db as never, "c", added!.id, "stopped");
    expect(await listMedications(db as never, "c", "p1", { activeOnly: true })).toHaveLength(0);
    expect(await listMedications(db as never, "c", "p1")).toHaveLength(1);
  });

  it("reads back only recent adherence", async () => {
    const db = createFakeDb({ medication_adherence: [{ id: "a", clientId: "c", patientId: "p1", medicationId: "m1", status: "taken", reportedAt: Date.now() - 2 * 86_400_000 }, { id: "b", clientId: "c", patientId: "p1", medicationId: "m1", status: "taken", reportedAt: Date.now() - 90 * 86_400_000 }] });
    expect((await listAdherence(db as never, "c", "p1")).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("medicine talk is recognised in every language the agent speaks", () => {
  it.each([
    "Did you take your tablet this morning?",
    "I forgot my medicine yesterday",
    "Maine goli nahi li",
    "dawai kha li aapne?",
    "दवाई ली आपने?",
    "मैंने गोली नहीं खाई",
    "which medication is that",
  ])("matches: %s", (text) => expect(MEDICATION_HINT.test(text)).toBe(true));

  it.each(["How is the weather", "I want to book for Friday", "mujhe kal aana hai"])("ignores: %s", (text) => expect(MEDICATION_HINT.test(text)).toBe(false));
});

describe("isMedicationTurn", () => {
  const system = "=== CARE PLAN ===\nMEDICATIONS prescribed:\n- Metformin 500 mg, twice a day — not asked yet [id=med_a]\n- Amlodipine, daily [id=med_b]\nrecord_medication_adherence";
  it("recognises a medicine named from the care plan, even without a generic word", () => {
    expect(isMedicationTurn("Yes I took my metformin", system)).toBe(true);
    expect(isMedicationTurn("amlodipine nahi li", system)).toBe(true);
  });
  it("does not fire without a care plan, or for unrelated talk", () => {
    expect(isMedicationTurn("Yes I took my metformin", "no care plan here")).toBe(false);
    expect(isMedicationTurn("The weather is lovely", system)).toBe(false);
  });
});
