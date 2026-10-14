import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";

/** Shared DB access for demo_requests (migration_v20.sql) — see that
 * migration's doc comment for why this table isn't clientId-scoped like
 * everything else. All functions here take a service-role client, since
 * the public submission route runs before any auth session exists and the
 * later linking/status routes need to bypass the table's narrow RLS
 * (public-insert-only, owner-read-only) to actually update rows. */

export type DemoRequestStatus = "awaiting_account" | "ready" | "calling" | "completed" | "failed" | "cancelled";

export interface DemoRequestRecord {
  id: string;
  hospitalName: string;
  institutionType: string | null;
  department: string | null;
  contactName: string;
  workEmail: string;
  phone: string;
  preferredLanguage: string | null;
  workflow: string | null;
  description: string | null;
  consent: boolean;
  status: DemoRequestStatus;
  linkedUserId: string | null;
  callSid: string | null;
  createdAt: number;
  linkedAt: number | null;
}

const COLUMNS =
  'id, "hospitalName", "institutionType", department, "contactName", "workEmail", phone, ' +
  '"preferredLanguage", workflow, description, consent, status, "linkedUserId", "callSid", "createdAt", "linkedAt"';

export async function createDemoRequest(
  db: SupabaseClient,
  fields: Omit<DemoRequestRecord, "id" | "status" | "linkedUserId" | "callSid" | "createdAt" | "linkedAt">,
): Promise<DemoRequestRecord | null> {
  const { data, error } = await db
    .from("demo_requests")
    .insert({
      id: nanoid(14),
      hospitalName: fields.hospitalName,
      institutionType: fields.institutionType,
      department: fields.department,
      contactName: fields.contactName,
      workEmail: fields.workEmail,
      phone: fields.phone,
      preferredLanguage: fields.preferredLanguage,
      workflow: fields.workflow,
      description: fields.description,
      consent: fields.consent,
      status: "awaiting_account",
      createdAt: Date.now(),
    })
    .select(COLUMNS)
    .single();
  if (error || !data) {
    console.error("[lib/db/demo-requests] createDemoRequest failed:", error?.message);
    return null;
  }
  return data as unknown as DemoRequestRecord;
}

export async function getDemoRequest(db: SupabaseClient, id: string): Promise<DemoRequestRecord | null> {
  const { data, error } = await db.from("demo_requests").select(COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as unknown as DemoRequestRecord;
}

/** Links a just-signed-up (or just-signed-in) user to their earlier,
 * pre-account demo request — spec §5.3 step 4. Only links a request that's
 * still unlinked and still awaiting an account, so a stale/guessed request
 * id can't hijack someone else's in-flight demo after the fact. */
export async function linkDemoRequestToUser(db: SupabaseClient, id: string, userId: string): Promise<DemoRequestRecord | null> {
  const { data, error } = await db
    .from("demo_requests")
    .update({ linkedUserId: userId, status: "ready", linkedAt: Date.now() })
    .eq("id", id)
    .is("linkedUserId", null)
    .eq("status", "awaiting_account")
    .select(COLUMNS)
    .single();
  if (error || !data) return null;
  return data as unknown as DemoRequestRecord;
}

export async function setDemoRequestCalling(db: SupabaseClient, id: string, userId: string, callSid: string): Promise<boolean> {
  const { error } = await db
    .from("demo_requests")
    .update({ status: "calling", callSid })
    .eq("id", id)
    .eq("linkedUserId", userId)
    .in("status", ["ready", "failed"]);
  return !error;
}

export async function updateDemoRequestStatusByCallSid(db: SupabaseClient, callSid: string, status: DemoRequestStatus): Promise<void> {
  await db.from("demo_requests").update({ status }).eq("callSid", callSid);
}
