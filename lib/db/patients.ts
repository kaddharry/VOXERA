import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";

/**
 * Shared DB access for the `patients` table (migration_v14.sql). Scoped by
 * "clientId" (auth_user_id) directly, same convention as call_logs/
 * memories/knowledge_documents — unlike lib/db/agents.ts's tenant_id
 * indirection, patients don't need a separate tenant-relationship lookup.
 */

export interface PatientRecord {
  id: string;
  clientId: string;
  name: string;
  phone: string;
  notes: string;
  assignedAgentId: string | null;
  nextCheckInAt: number | null;
  createdAt: number;
}

export interface PatientFields {
  name: string;
  phone: string;
  notes?: string;
  assignedAgentId?: string | null;
  nextCheckInAt?: number | null;
}

const PATIENT_COLUMNS = 'id, "clientId", name, phone, notes, "assignedAgentId", "nextCheckInAt", "createdAt"';

export async function listPatients(db: SupabaseClient, clientId: string): Promise<PatientRecord[]> {
  const { data, error } = await db
    .from("patients")
    .select(PATIENT_COLUMNS)
    .eq("clientId", clientId)
    .order("createdAt", { ascending: false });
  if (error || !data) return [];
  return data as unknown as PatientRecord[];
}

export async function getPatient(db: SupabaseClient, patientId: string, clientId: string): Promise<PatientRecord | null> {
  const { data, error } = await db
    .from("patients")
    .select(PATIENT_COLUMNS)
    .eq("id", patientId)
    .eq("clientId", clientId)
    .single();
  if (error || !data) return null;
  return data as unknown as PatientRecord;
}

/** No clientId scoping — used server-side (e.g. orchestrator resolving
 * per-call patient context) where the caller is trusted infrastructure, not
 * a per-request authenticated tenant boundary. Mirrors getAgentWithTenant's
 * unscoped lookup in lib/db/agents.ts for the same reason. */
export async function getPatientById(db: SupabaseClient, patientId: string): Promise<PatientRecord | null> {
  const { data, error } = await db.from("patients").select(PATIENT_COLUMNS).eq("id", patientId).single();
  if (error || !data) return null;
  return data as unknown as PatientRecord;
}

export async function createPatient(db: SupabaseClient, clientId: string, fields: PatientFields): Promise<PatientRecord | null> {
  const { data, error } = await db
    .from("patients")
    .insert({
      id: nanoid(12),
      clientId,
      name: fields.name,
      phone: fields.phone,
      notes: fields.notes ?? "",
      assignedAgentId: fields.assignedAgentId ?? null,
      nextCheckInAt: fields.nextCheckInAt ?? null,
      createdAt: Date.now(),
    })
    .select(PATIENT_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[lib/db/patients] createPatient failed:", error?.message);
    return null;
  }
  return data as unknown as PatientRecord;
}

export async function updatePatient(
  db: SupabaseClient,
  patientId: string,
  clientId: string,
  fields: Partial<PatientFields>
): Promise<PatientRecord | null> {
  const { data, error } = await db
    .from("patients")
    .update(fields)
    .eq("id", patientId)
    .eq("clientId", clientId)
    .select(PATIENT_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[lib/db/patients] updatePatient failed:", error?.message);
    return null;
  }
  return data as unknown as PatientRecord;
}

export async function deletePatient(db: SupabaseClient, patientId: string, clientId: string): Promise<boolean> {
  const { error } = await db.from("patients").delete().eq("id", patientId).eq("clientId", clientId);
  if (error) {
    console.error("[lib/db/patients] deletePatient failed:", error.message);
    return false;
  }
  return true;
}
