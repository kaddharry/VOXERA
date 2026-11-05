import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "./follow-up-tasks";

/**
 * Shared DB access for the `appointments` table (migration_v30.sql).
 * Scoped by "client_id" (= tenants.auth_user_id), same convention as
 * patients/reservations/follow_up_tasks — see lib/db/patients.ts.
 *
 * Reminder-call creation/cancellation (the 72h/24h/2h follow_up_tasks rows)
 * and waitlist backfill are wired in on top of bookAppointment/
 * cancelAppointment by migration_v31.sql's follow-up work (PR 5 of the
 * calendar plan) — this file is the plain CRUD layer underneath that.
 */

export type AppointmentVisitType = "consultation" | "follow_up" | "procedure" | "telehealth" | "other";
export type AppointmentStatus = "scheduled" | "confirmed" | "checked_in" | "completed" | "no_show" | "cancelled";
export type AppointmentBookedVia = "staff" | "ai_call";

export interface AppointmentRecord {
  id: string;
  tenant_id: string;
  client_id: string;
  provider_id: string;
  patient_id: string;
  starts_at: string;
  ends_at: string;
  visit_type: AppointmentVisitType;
  status: AppointmentStatus;
  notes: string | null;
  booked_via: AppointmentBookedVia;
  booked_by_session_id: string | null;
  created_by_user_id: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  reminder_72h_task_id: string | null;
  reminder_24h_task_id: string | null;
  reminder_2h_task_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookAppointmentArgs {
  tenantId: string;
  clientId: string;
  providerId: string;
  patientId: string;
  startsAt: string; // ISO 8601
  endsAt: string; // ISO 8601
  visitType?: AppointmentVisitType;
  notes?: string | null;
  bookedVia?: AppointmentBookedVia;
  bookedBySessionId?: string | null;
  createdByUserId?: string | null;
}

const APPOINTMENT_COLUMNS =
  "id, tenant_id, client_id, provider_id, patient_id, starts_at, ends_at, visit_type, status, notes, " +
  "booked_via, booked_by_session_id, created_by_user_id, cancelled_at, cancel_reason, " +
  "reminder_72h_task_id, reminder_24h_task_id, reminder_2h_task_id, created_at, updated_at";

/** Postgres raises book_appointment_atomic/reschedule_appointment_atomic's
 * conflict exception with this ERRCODE (migration_v30.sql) — the specific,
 * narrow signal of "overlapping appointment", as opposed to any other RPC
 * failure. */
function isOverlapConflict(error: { code?: string } | null): boolean {
  return error?.code === "P0001";
}

export class AppointmentConflictError extends Error {
  constructor(message = "That provider already has an overlapping appointment in that window.") {
    super(message);
    this.name = "AppointmentConflictError";
  }
}

export async function checkAppointmentAvailability(
  db: SupabaseClient,
  providerId: string,
  startsAt: string,
  endsAt: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("appointments")
    .select("id")
    .eq("provider_id", providerId)
    .not("status", "in", "(cancelled,no_show)")
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt);
  if (error) {
    console.error("[lib/db/appointments] checkAppointmentAvailability failed:", error.message);
    throw new Error("Failed to check appointment availability.");
  }
  return (data?.length ?? 0) === 0;
}

export async function bookAppointment(db: SupabaseClient, args: BookAppointmentArgs): Promise<AppointmentRecord> {
  const { data, error } = await db.rpc("book_appointment_atomic", {
    p_tenant_id: args.tenantId,
    p_client_id: args.clientId,
    p_provider_id: args.providerId,
    p_patient_id: args.patientId,
    p_starts_at: args.startsAt,
    p_ends_at: args.endsAt,
    p_visit_type: args.visitType ?? "consultation",
    p_notes: args.notes ?? null,
    p_booked_via: args.bookedVia ?? "staff",
    p_booked_by_session_id: args.bookedBySessionId ?? null,
    p_created_by_user_id: args.createdByUserId ?? null,
  });
  if (error) {
    if (isOverlapConflict(error)) throw new AppointmentConflictError();
    console.error("[lib/db/appointments] bookAppointment failed:", error.message);
    throw new Error(error.message || "Failed to book appointment.");
  }
  return data as unknown as AppointmentRecord;
}

export async function rescheduleAppointment(
  db: SupabaseClient,
  appointmentId: string,
  clientId: string,
  newStartsAt: string,
  newEndsAt: string,
): Promise<AppointmentRecord> {
  const { data, error } = await db.rpc("reschedule_appointment_atomic", {
    p_appointment_id: appointmentId,
    p_client_id: clientId,
    p_new_starts_at: newStartsAt,
    p_new_ends_at: newEndsAt,
  });
  if (error) {
    if (isOverlapConflict(error)) throw new AppointmentConflictError();
    console.error("[lib/db/appointments] rescheduleAppointment failed:", error.message);
    throw new Error(error.message || "Failed to reschedule appointment.");
  }
  return data as unknown as AppointmentRecord;
}

export async function cancelAppointment(
  db: SupabaseClient,
  appointmentId: string,
  clientId: string,
  reason?: string,
): Promise<AppointmentRecord | null> {
  const { data, error } = await db
    .from("appointments")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason ?? null })
    .eq("id", appointmentId)
    .eq("client_id", clientId)
    .select(APPOINTMENT_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[lib/db/appointments] cancelAppointment failed:", error?.message);
    return null;
  }
  return data as unknown as AppointmentRecord;
}

async function setStatus(
  db: SupabaseClient,
  appointmentId: string,
  clientId: string,
  status: AppointmentStatus,
): Promise<AppointmentRecord | null> {
  const { data, error } = await db
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId)
    .eq("client_id", clientId)
    .select(APPOINTMENT_COLUMNS)
    .single();
  if (error || !data) {
    console.error(`[lib/db/appointments] setStatus(${status}) failed:`, error?.message);
    return null;
  }
  return data as unknown as AppointmentRecord;
}

export async function updateAppointmentNotes(
  db: SupabaseClient,
  appointmentId: string,
  clientId: string,
  notes: string | null,
): Promise<AppointmentRecord | null> {
  const { data, error } = await db
    .from("appointments")
    .update({ notes })
    .eq("id", appointmentId)
    .eq("client_id", clientId)
    .select(APPOINTMENT_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[lib/db/appointments] updateAppointmentNotes failed:", error?.message);
    return null;
  }
  return data as unknown as AppointmentRecord;
}

export const confirmAppointment = (db: SupabaseClient, appointmentId: string, clientId: string) =>
  setStatus(db, appointmentId, clientId, "confirmed");
export const checkInAppointment = (db: SupabaseClient, appointmentId: string, clientId: string) =>
  setStatus(db, appointmentId, clientId, "checked_in");
export const completeAppointment = (db: SupabaseClient, appointmentId: string, clientId: string) =>
  setStatus(db, appointmentId, clientId, "completed");
export const markNoShow = (db: SupabaseClient, appointmentId: string, clientId: string) =>
  setStatus(db, appointmentId, clientId, "no_show");

export async function listAppointmentsForRange(
  db: SupabaseClient,
  clientId: string,
  options: { from: string; to: string; providerId?: string },
): Promise<AppointmentRecord[]> {
  let query = db
    .from("appointments")
    .select(APPOINTMENT_COLUMNS)
    .eq("client_id", clientId)
    .lt("starts_at", options.to)
    .gt("ends_at", options.from)
    .order("starts_at", { ascending: true });
  if (options.providerId) query = query.eq("provider_id", options.providerId);
  const { data, error } = await query;
  if (error || !data) {
    if (error) console.error("[lib/db/appointments] listAppointmentsForRange failed:", error.message);
    return [];
  }
  return data as unknown as AppointmentRecord[];
}

export async function listAppointmentsForPatient(db: SupabaseClient, patientId: string, clientId: string): Promise<AppointmentRecord[]> {
  const { data, error } = await db
    .from("appointments")
    .select(APPOINTMENT_COLUMNS)
    .eq("patient_id", patientId)
    .eq("client_id", clientId)
    .order("starts_at", { ascending: false });
  if (error || !data) {
    if (error) console.error("[lib/db/appointments] listAppointmentsForPatient failed:", error.message);
    return [];
  }
  return data as unknown as AppointmentRecord[];
}

export async function getAppointmentById(db: SupabaseClient, appointmentId: string, clientId: string): Promise<AppointmentRecord | null> {
  const { data, error } = await db.from("appointments").select(APPOINTMENT_COLUMNS).eq("id", appointmentId).eq("client_id", clientId).single();
  if (error || !data) return null;
  return data as unknown as AppointmentRecord;
}

/** Distinct patient ids with at least one appointment under this provider —
 * backs the staff-directory "click a provider -> see their patients"
 * slide-over (app/admin/staff/page.tsx). `upcomingOnly` restricts to
 * appointments that haven't happened yet and aren't cancelled. */
export async function listDistinctPatientIdsForProvider(
  db: SupabaseClient,
  providerId: string,
  clientId: string,
  options?: { upcomingOnly?: boolean },
): Promise<string[]> {
  let query = db.from("appointments").select("patient_id").eq("provider_id", providerId).eq("client_id", clientId);
  if (options?.upcomingOnly) {
    query = query.not("status", "in", "(cancelled,no_show,completed)").gte("starts_at", new Date().toISOString());
  }
  const { data, error } = await query;
  if (error || !data) {
    if (error) console.error("[lib/db/appointments] listDistinctPatientIdsForProvider failed:", error.message);
    return [];
  }
  return Array.from(new Set((data as { patient_id: string }[]).map((r) => r.patient_id)));
}

/** Unscoped by clientId — used server-side (agent tool handlers that have
 * already verified the caller via phone-number match) where re-deriving
 * clientId isn't otherwise needed, mirroring lib/db/patients.ts's
 * getPatientById. Still re-exported here rather than inlined so every
 * trusted-caller lookup goes through one documented, intentional path. */
export async function getAppointmentByIdUnscoped(db: SupabaseClient, appointmentId: string): Promise<AppointmentRecord | null> {
  const { data, error } = await db.from("appointments").select(APPOINTMENT_COLUMNS).eq("id", appointmentId).single();
  if (error || !data) return null;
  return data as unknown as AppointmentRecord;
}

// Re-exported so API routes/tool handlers that only import from this file
// can still recognize a pre-migration "missing column" error the same way
// lib/db/patients.ts and lib/db/agents.ts do.
export { isMissingColumnError };
