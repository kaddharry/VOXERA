import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";

/**
 * Shared DB access for the `patients` table (migration_v14.sql). Scoped by
 * "clientId" (auth_user_id) directly, same convention as call_logs/
 * memories/knowledge_documents — unlike lib/db/agents.ts's tenant_id
 * indirection, patients don't need a separate tenant-relationship lookup.
 */

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface PatientRecord {
  id: string;
  clientId: string;
  name: string;
  phone: string;
  notes: string;
  assignedAgentId: string | null;
  nextCheckInAt: number | null;
  createdAt: number;
  /** spec §17.4 — once true, no call path may dial this patient again
   * until a staff member explicitly clears it. Set either manually (see
   * setDoNotContact below) or automatically when a call's post-call
   * summary detects the patient asked to stop (lib/agent/call-summary.ts's
   * requestedStop field, applied in app/api/telephony/status/route.ts). */
  doNotContact: boolean;
  doNotContactAt: number | null;
  doNotContactReason: string | null;
  /** Free-text diagnosis/category label (migration_v28.sql) — e.g. "Post-Op
   * Recovery", "Type 2 Diabetes". Deliberately not a fixed taxonomy; the
   * Patients table derives its filter options from whatever values are
   * actually in use. */
  condition: string | null;
  /** Drives the color-coded badge everywhere a patient shows up
   * (migration_v28.sql). */
  riskLevel: RiskLevel;
}

export interface PatientFields {
  name: string;
  phone: string;
  notes?: string;
  assignedAgentId?: string | null;
  nextCheckInAt?: number | null;
  condition?: string | null;
  riskLevel?: RiskLevel;
}

const BASE_PATIENT_COLUMNS =
  'id, "clientId", name, phone, notes, "assignedAgentId", "nextCheckInAt", "createdAt", "doNotContact", "doNotContactAt", "doNotContactReason"';
const PATIENT_COLUMNS = `${BASE_PATIENT_COLUMNS}, "condition", "riskLevel"`;

/** Postgres' "column does not exist" SQLSTATE — the specific, narrow signal
 * that migration_v28.sql hasn't been run (or its schema cache hasn't
 * refreshed) yet, as opposed to some other, real query failure. Only this
 * exact error triggers the base-columns fallback below; anything else is
 * still reported as a genuine failure. */
function isMissingColumnError(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

/** Fills in defaults for rows read via the base-columns fallback (which
 * simply won't have `condition`/`riskLevel` keys at all) so every caller
 * still gets a complete, consistently-shaped PatientRecord either way. */
function withDefaults(row: Record<string, unknown>): PatientRecord {
  return {
    ...row,
    condition: (row.condition as string | null | undefined) ?? null,
    riskLevel: (row.riskLevel as RiskLevel | undefined) ?? "low",
  } as PatientRecord;
}

/** Runs a patients-table select/update/insert with PATIENT_COLUMNS first;
 * if that fails specifically because the condition/riskLevel columns don't
 * exist yet, retries with just BASE_PATIENT_COLUMNS — so every patient
 * already in the database keeps showing up (without the new fields) while
 * migration_v28.sql hasn't been run, instead of the whole list silently
 * going empty. */
async function withPatientColumnFallback<T>(
  run: (columns: string) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>,
): Promise<{ data: T | null; error: { code?: string; message: string } | null; migrationPending: boolean }> {
  const result = await run(PATIENT_COLUMNS);
  if (result.error && isMissingColumnError(result.error)) {
    const fallback = await run(BASE_PATIENT_COLUMNS);
    return { ...fallback, migrationPending: true };
  }
  return { ...result, migrationPending: false };
}

export async function listPatients(db: SupabaseClient, clientId: string): Promise<PatientRecord[]> {
  const { data, error, migrationPending } = await withPatientColumnFallback((columns) =>
    db.from("patients").select(columns).eq("clientId", clientId).order("createdAt", { ascending: false }),
  );
  if (migrationPending) {
    console.warn("[lib/db/patients] \"condition\"/\"riskLevel\" columns not found — run sql/migration_v28.sql. Showing patients without them in the meantime.");
  }
  if (error) {
    console.error("[lib/db/patients] listPatients failed:", error.message);
    return [];
  }
  if (!data) return [];
  return (data as unknown as Record<string, unknown>[]).map(withDefaults);
}

export async function getPatient(db: SupabaseClient, patientId: string, clientId: string): Promise<PatientRecord | null> {
  const { data, error } = await withPatientColumnFallback((columns) =>
    db.from("patients").select(columns).eq("id", patientId).eq("clientId", clientId).single(),
  );
  if (error) {
    console.error("[lib/db/patients] getPatient failed:", error.message);
    return null;
  }
  if (!data) return null;
  return withDefaults(data as unknown as Record<string, unknown>);
}

/** No clientId scoping — used server-side (e.g. orchestrator resolving
 * per-call patient context) where the caller is trusted infrastructure, not
 * a per-request authenticated tenant boundary. Mirrors getAgentWithTenant's
 * unscoped lookup in lib/db/agents.ts for the same reason. */
export async function getPatientById(db: SupabaseClient, patientId: string): Promise<PatientRecord | null> {
  const { data, error } = await withPatientColumnFallback((columns) =>
    db.from("patients").select(columns).eq("id", patientId).single(),
  );
  if (error || !data) return null;
  return withDefaults(data as unknown as Record<string, unknown>);
}

export async function createPatient(db: SupabaseClient, clientId: string, fields: PatientFields): Promise<PatientRecord | null> {
  const payload: Record<string, unknown> = {
    id: nanoid(12),
    clientId,
    name: fields.name,
    phone: fields.phone,
    notes: fields.notes ?? "",
    assignedAgentId: fields.assignedAgentId ?? null,
    nextCheckInAt: fields.nextCheckInAt ?? null,
    condition: fields.condition ?? null,
    riskLevel: fields.riskLevel ?? "low",
    createdAt: Date.now(),
  };

  let { data, error } = await db.from("patients").insert(payload).select(PATIENT_COLUMNS).single();
  if (error && isMissingColumnError(error)) {
    console.warn("[lib/db/patients] \"condition\"/\"riskLevel\" columns not found — run sql/migration_v28.sql. Creating patient without them in the meantime.");
    const { condition: _condition, riskLevel: _riskLevel, ...basePayload } = payload;
    void _condition;
    void _riskLevel;
    ({ data, error } = await db.from("patients").insert(basePayload).select(BASE_PATIENT_COLUMNS).single());
  }
  if (error || !data) {
    console.error("[lib/db/patients] createPatient failed:", error?.message);
    return null;
  }
  return withDefaults(data as unknown as Record<string, unknown>);
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
    if (isMissingColumnError(error)) {
      console.error("[lib/db/patients] updatePatient failed: \"condition\"/\"riskLevel\" columns don't exist yet — run sql/migration_v28.sql before editing them.");
    } else {
      console.error("[lib/db/patients] updatePatient failed:", error?.message);
    }
    return null;
  }
  return withDefaults(data as unknown as Record<string, unknown>);
}

export async function deletePatient(db: SupabaseClient, patientId: string, clientId: string): Promise<boolean> {
  const { error } = await db.from("patients").delete().eq("id", patientId).eq("clientId", clientId);
  if (error) {
    console.error("[lib/db/patients] deletePatient failed:", error.message);
    return false;
  }
  return true;
}

/** Sets or clears a patient's do-not-contact flag (spec §17.4). Unscoped by
 * clientId variant intentionally NOT provided — every caller of this must
 * know the owning tenant, so there's no accidental cross-tenant path here
 * the way getPatientById's unscoped read has for trusted server callers. */
export async function setDoNotContact(
  db: SupabaseClient,
  patientId: string,
  clientId: string,
  value: boolean,
  reason?: string,
): Promise<PatientRecord | null> {
  const { data, error } = await withPatientColumnFallback((columns) =>
    db
      .from("patients")
      .update({
        doNotContact: value,
        doNotContactAt: value ? Date.now() : null,
        doNotContactReason: value ? (reason ?? null) : null,
      })
      .eq("id", patientId)
      .eq("clientId", clientId)
      .select(columns)
      .single(),
  );
  if (error || !data) return null;
  return withDefaults(data as unknown as Record<string, unknown>);
}
