import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";

/** Doctor → doctor referrals (migration_v37.sql). The receiving doctor sees the patient only once a referral
 * to them exists (lib/db/doctor.ts's myPatientIds), and can accept or decline with a note. */

export type ReferralStatus = "pending" | "accepted" | "declined" | "completed" | "cancelled";
export type ReferralUrgency = "routine" | "soon" | "urgent";
export const REFERRAL_URGENCIES: readonly ReferralUrgency[] = ["routine", "soon", "urgent"];

export interface ReferralRecord {
  id: string;
  clientId: string;
  tenant_id: string;
  patientId: string;
  from_provider_id: string;
  to_provider_id: string;
  reason: string;
  urgency: ReferralUrgency;
  status: ReferralStatus;
  response_note: string | null;
  appointment_id: string | null;
  created_at: string;
  responded_at: string | null;
  patientName?: string;
  fromName?: string;
  toName?: string;
}

export class ReferralError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const COLUMNS = 'id, "clientId", tenant_id, "patientId", from_provider_id, to_provider_id, reason, urgency, status, response_note, appointment_id, created_at, responded_at';

export async function createReferral(
  db: SupabaseClient,
  input: {
    clientId: string;
    tenantId: string;
    patientId: string;
    fromProviderId: string;
    toProviderId: string;
    reason: string;
    urgency?: ReferralUrgency;
    createdByUserId?: string | null;
  },
): Promise<ReferralRecord> {
  if (input.fromProviderId === input.toProviderId) throw new ReferralError("Choose a different doctor to refer to.");
  const reason = input.reason.trim();
  if (reason.length < 5) throw new ReferralError("Add a short reason for the referral.");

  const { data: target } = await db.from("providers").select("id, status").eq("id", input.toProviderId).eq("tenant_id", input.tenantId).maybeSingle();
  if (!target) throw new ReferralError("That doctor isn't part of this hospital.", 404);
  if (target.status !== "active") throw new ReferralError("That doctor isn't taking referrals right now.", 409);

  const { data: dup } = await db
    .from("referrals")
    .select("id")
    .eq("clientId", input.clientId)
    .eq("patientId", input.patientId)
    .eq("to_provider_id", input.toProviderId)
    .eq("status", "pending")
    .maybeSingle();
  if (dup) throw new ReferralError("This patient already has a pending referral to that doctor.", 409);

  const { data, error } = await db
    .from("referrals")
    .insert({
      id: `ref_${nanoid(10)}`,
      clientId: input.clientId,
      tenant_id: input.tenantId,
      patientId: input.patientId,
      from_provider_id: input.fromProviderId,
      to_provider_id: input.toProviderId,
      reason: reason.slice(0, 1000),
      urgency: input.urgency ?? "routine",
      status: "pending",
      created_at: new Date().toISOString(),
      created_by_user_id: input.createdByUserId ?? null,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) throw new ReferralError(`Could not create the referral: ${error?.message ?? "unknown error"}`, 500);
  return data as unknown as ReferralRecord;
}

export async function listReferrals(
  db: SupabaseClient,
  clientId: string,
  filter: { providerId?: string; direction?: "incoming" | "outgoing" | "all"; patientId?: string; status?: ReferralStatus },
): Promise<ReferralRecord[]> {
  let q = db.from("referrals").select(COLUMNS).eq("clientId", clientId);
  if (filter.patientId) q = q.eq("patientId", filter.patientId);
  if (filter.status) q = q.eq("status", filter.status);
  const { data } = await q.order("created_at", { ascending: false });
  let rows = (data ?? []) as unknown as ReferralRecord[];
  if (filter.providerId) {
    const me = filter.providerId;
    rows = rows.filter((r) =>
      filter.direction === "incoming" ? r.to_provider_id === me : filter.direction === "outgoing" ? r.from_provider_id === me : r.to_provider_id === me || r.from_provider_id === me,
    );
  }
  if (rows.length === 0) return rows;

  const [{ data: provs }, { data: pats }] = await Promise.all([
    db.from("providers").select("id, name").in("id", [...new Set(rows.flatMap((r) => [r.from_provider_id, r.to_provider_id]))]),
    db.from("patients").select("id, name").eq("clientId", clientId).in("id", [...new Set(rows.map((r) => r.patientId))]),
  ]);
  const pn = new Map(((provs ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const patn = new Map(((pats ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  return rows.map((r) => ({ ...r, patientName: patn.get(r.patientId) ?? "Unknown patient", fromName: pn.get(r.from_provider_id), toName: pn.get(r.to_provider_id) }));
}

export type ReferralAction = "accept" | "decline" | "complete" | "cancel";

/** Who may do what: only the receiving doctor accepts/declines/completes; only the sender cancels, and only while pending. */
export async function respondToReferral(
  db: SupabaseClient,
  input: { clientId: string; referralId: string; actingProviderId: string; action: ReferralAction; note?: string | null; appointmentId?: string | null },
): Promise<ReferralRecord> {
  const { data: current } = await db.from("referrals").select(COLUMNS).eq("clientId", input.clientId).eq("id", input.referralId).maybeSingle();
  const ref = current as unknown as ReferralRecord | null;
  if (!ref) throw new ReferralError("Referral not found.", 404);

  const isReceiver = ref.to_provider_id === input.actingProviderId;
  const isSender = ref.from_provider_id === input.actingProviderId;
  let next: ReferralStatus;
  switch (input.action) {
    case "accept":
    case "decline":
      if (!isReceiver) throw new ReferralError("Only the doctor this was sent to can respond.", 403);
      if (ref.status !== "pending") throw new ReferralError("This referral was already answered.", 409);
      if (input.action === "decline" && !input.note?.trim()) throw new ReferralError("Say briefly why you are declining.");
      next = input.action === "accept" ? "accepted" : "declined";
      break;
    case "complete":
      if (!isReceiver) throw new ReferralError("Only the receiving doctor can mark this complete.", 403);
      if (ref.status !== "accepted") throw new ReferralError("Accept the referral first.", 409);
      next = "completed";
      break;
    case "cancel":
      if (!isSender) throw new ReferralError("Only the referring doctor can cancel.", 403);
      if (ref.status !== "pending") throw new ReferralError("Only a pending referral can be cancelled.", 409);
      next = "cancelled";
      break;
  }

  const { data, error } = await db
    .from("referrals")
    .update({
      status: next,
      response_note: input.note?.trim().slice(0, 500) || ref.response_note,
      responded_at: new Date().toISOString(),
      ...(input.appointmentId ? { appointment_id: input.appointmentId } : {}),
    })
    .eq("id", input.referralId)
    .eq("clientId", input.clientId)
    .select(COLUMNS)
    .single();
  if (error || !data) throw new ReferralError("Could not update the referral.", 500);
  return data as unknown as ReferralRecord;
}
