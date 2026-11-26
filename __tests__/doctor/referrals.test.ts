import { describe, expect, it } from "vitest";
import { createFakeDb } from "../helpers/fake-supabase";
import { createReferral, listReferrals, respondToReferral } from "../../lib/db/referrals";
import { myPatientIds } from "../../lib/db/doctor";

const seed = () =>
  createFakeDb({
    providers: [
      { id: "docA", tenant_id: "t1", name: "Dr. A", status: "active" },
      { id: "docB", tenant_id: "t1", name: "Dr. B (cardio)", status: "active" },
      { id: "docC", tenant_id: "t1", name: "Dr. C", status: "inactive" },
      { id: "docX", tenant_id: "t2", name: "Other hospital", status: "active" },
    ],
    patients: [{ id: "pt1", clientId: "c", name: "Asha", primaryProviderId: "docA" }],
    referrals: [],
    appointments: [],
  });
const base = { clientId: "c", tenantId: "t1", patientId: "pt1", fromProviderId: "docA", toProviderId: "docB", reason: "Chest tightness on exertion" };

describe("doctor → doctor referral", () => {
  it("creates a pending referral", async () => {
    const db = seed();
    const r = await createReferral(db as never, { ...base, urgency: "soon" });
    expect(r).toMatchObject({ status: "pending", urgency: "soon", from_provider_id: "docA", to_provider_id: "docB", patientId: "pt1" });
  });

  it("refuses a self-referral, a vague reason, another hospital's doctor, an inactive doctor, and a duplicate pending one", async () => {
    const db = seed();
    await expect(createReferral(db as never, { ...base, toProviderId: "docA" })).rejects.toThrow(/different doctor/);
    await expect(createReferral(db as never, { ...base, reason: "hi" })).rejects.toThrow(/short reason/);
    await expect(createReferral(db as never, { ...base, toProviderId: "docX" })).rejects.toMatchObject({ status: 404 });
    await expect(createReferral(db as never, { ...base, toProviderId: "docC" })).rejects.toMatchObject({ status: 409 });
    await createReferral(db as never, base);
    await expect(createReferral(db as never, base)).rejects.toMatchObject({ status: 409 });
  });

  it("the receiving doctor sees the patient once referred, the referring doctor still does, and others don't", async () => {
    const db = seed();
    expect((await myPatientIds(db as never, { clientId: "c", tenantId: "t1", providerId: "docB" })).has("pt1")).toBe(false);
    await createReferral(db as never, base);
    expect((await myPatientIds(db as never, { clientId: "c", tenantId: "t1", providerId: "docB" })).get("pt1")).toBe("referral");
    expect((await myPatientIds(db as never, { clientId: "c", tenantId: "t1", providerId: "docA" })).get("pt1")).toBe("primary");
  });

  it("only the receiving doctor accepts or declines, once", async () => {
    const db = seed();
    const ref = await createReferral(db as never, base);
    const act = (who: string, action: "accept" | "decline" | "complete" | "cancel", note?: string) => respondToReferral(db as never, { clientId: "c", referralId: ref.id, actingProviderId: who, action, note });
    await expect(act("docA", "accept")).rejects.toMatchObject({ status: 403 });
    await expect(act("docB", "decline")).rejects.toThrow(/why you are declining/);
    const accepted = await act("docB", "accept", "Happy to see them");
    expect(accepted).toMatchObject({ status: "accepted", response_note: "Happy to see them" });
    expect(accepted.responded_at).toBeTruthy();
    await expect(act("docB", "accept")).rejects.toMatchObject({ status: 409 });
  });

  it("a declined referral gives the receiving doctor no access", async () => {
    const db = seed();
    const ref = await createReferral(db as never, base);
    await respondToReferral(db as never, { clientId: "c", referralId: ref.id, actingProviderId: "docB", action: "decline", note: "Not my area" });
    expect((await myPatientIds(db as never, { clientId: "c", tenantId: "t1", providerId: "docB" })).has("pt1")).toBe(false);
  });

  it("completes only after accepting; the sender can withdraw only while pending", async () => {
    const db = seed();
    const ref = await createReferral(db as never, base);
    await expect(respondToReferral(db as never, { clientId: "c", referralId: ref.id, actingProviderId: "docB", action: "complete" })).rejects.toMatchObject({ status: 409 });
    await expect(respondToReferral(db as never, { clientId: "c", referralId: ref.id, actingProviderId: "docB", action: "cancel" })).rejects.toMatchObject({ status: 403 });
    await respondToReferral(db as never, { clientId: "c", referralId: ref.id, actingProviderId: "docB", action: "accept", appointmentId: "appt-1" });
    await expect(respondToReferral(db as never, { clientId: "c", referralId: ref.id, actingProviderId: "docA", action: "cancel" })).rejects.toMatchObject({ status: 409 });
    expect(await respondToReferral(db as never, { clientId: "c", referralId: ref.id, actingProviderId: "docB", action: "complete" })).toMatchObject({ status: "completed", appointment_id: "appt-1" });

    const second = await createReferral(db as never, { ...base, toProviderId: "docB", reason: "Second opinion please" });
    expect((await respondToReferral(db as never, { clientId: "c", referralId: second.id, actingProviderId: "docA", action: "cancel" })).status).toBe("cancelled");
  });

  it("is scoped to the hospital", async () => {
    const db = seed();
    const ref = await createReferral(db as never, base);
    await expect(respondToReferral(db as never, { clientId: "other", referralId: ref.id, actingProviderId: "docB", action: "accept" })).rejects.toMatchObject({ status: 404 });
  });

  it("lists incoming and outgoing for a doctor with names", async () => {
    const db = seed();
    await createReferral(db as never, base);
    const incoming = await listReferrals(db as never, "c", { providerId: "docB", direction: "incoming" });
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({ patientName: "Asha", fromName: "Dr. A", toName: "Dr. B (cardio)" });
    expect(await listReferrals(db as never, "c", { providerId: "docB", direction: "outgoing" })).toHaveLength(0);
    expect(await listReferrals(db as never, "c", { providerId: "docA", direction: "outgoing" })).toHaveLength(1);
    expect(await listReferrals(db as never, "other", {})).toHaveLength(0);
  });
});
