import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared DB access for `appointment_waitlist` (migration_v31.sql) — CRUD
 * only. The backfill loop that actually calls waitlisted patients when a
 * slot opens up lives in lib/scheduler/waitlist.ts (wired in alongside the
 * reminder-call work, PR 5 of the calendar plan), not here.
 */

export type WaitlistStatus = "open" | "offered" | "booked" | "expired" | "cancelled";

export interface WaitlistEntry {
  id: string;
  tenant_id: string;
  client_id: string;
  patient_id: string;
  provider_id: string | null;
  desired_visit_type: string | null;
  window_start: string | null;
  window_end: string | null;
  notes: string | null;
  status: WaitlistStatus;
  created_at: string;
}

export interface CreateWaitlistEntryArgs {
  patientId: string;
  providerId?: string | null;
  desiredVisitType?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  notes?: string | null;
}

const WAITLIST_COLUMNS =
  "id, tenant_id, client_id, patient_id, provider_id, desired_visit_type, window_start, window_end, notes, status, created_at";

export async function listWaitlistEntries(
  db: SupabaseClient,
  clientId: string,
  options?: { providerId?: string; status?: WaitlistStatus },
): Promise<WaitlistEntry[]> {
  let query = db.from("appointment_waitlist").select(WAITLIST_COLUMNS).eq("client_id", clientId).order("created_at", { ascending: true });
  if (options?.providerId) query = query.eq("provider_id", options.providerId);
  if (options?.status) query = query.eq("status", options.status);
  const { data, error } = await query;
  if (error || !data) {
    if (error) console.error("[lib/db/waitlist] listWaitlistEntries failed:", error.message);
    return [];
  }
  return data as unknown as WaitlistEntry[];
}

export async function addToWaitlist(
  db: SupabaseClient,
  tenantId: string,
  clientId: string,
  args: CreateWaitlistEntryArgs,
): Promise<WaitlistEntry | null> {
  const payload = {
    tenant_id: tenantId,
    client_id: clientId,
    patient_id: args.patientId,
    provider_id: args.providerId ?? null,
    desired_visit_type: args.desiredVisitType ?? null,
    window_start: args.windowStart ?? null,
    window_end: args.windowEnd ?? null,
    notes: args.notes ?? null,
    status: "open" as const,
  };
  const { data, error } = await db.from("appointment_waitlist").insert(payload).select(WAITLIST_COLUMNS).single();
  if (error || !data) {
    console.error("[lib/db/waitlist] addToWaitlist failed:", error?.message);
    return null;
  }
  return data as unknown as WaitlistEntry;
}

/** Unscoped by clientId — used by the backfill loop (lib/scheduler/
 * appointment-reminders.ts) to re-fetch an entry it already resolved via a
 * clientId-scoped query, when it needs the entry's provider_id/tenant_id
 * to try the next waitlist candidate. */
export async function getWaitlistEntryById(db: SupabaseClient, entryId: string): Promise<WaitlistEntry | null> {
  const { data, error } = await db.from("appointment_waitlist").select(WAITLIST_COLUMNS).eq("id", entryId).maybeSingle();
  if (error || !data) return null;
  return data as unknown as WaitlistEntry;
}

/** Unscoped by clientId — used by the backfill loop (lib/scheduler/
 * appointment-reminders.ts), which already resolved the entry via a
 * clientId-scoped query and just needs to advance its status afterward. */
export async function setWaitlistEntryStatus(db: SupabaseClient, entryId: string, status: WaitlistStatus): Promise<void> {
  await db.from("appointment_waitlist").update({ status }).eq("id", entryId);
}

export async function removeFromWaitlist(db: SupabaseClient, entryId: string, clientId: string): Promise<boolean> {
  const { error } = await db
    .from("appointment_waitlist")
    .update({ status: "cancelled" })
    .eq("id", entryId)
    .eq("client_id", clientId);
  if (error) {
    console.error("[lib/db/waitlist] removeFromWaitlist failed:", error.message);
    return false;
  }
  return true;
}
