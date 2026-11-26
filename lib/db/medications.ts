import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";

/**
 * Medications a doctor prescribed and what patients report taking (migration_v37.sql).
 * Adherence is reported on calls (the agent asks about each medicine and records the answer with
 * the record_medication_adherence tool) or entered by the doctor. Everything here is scoped by
 * clientId (the hospital) so a route can never read another hospital's medicines.
 */

export type MedicationStatus = "active" | "stopped" | "completed";
export type AdherenceStatus = "taken" | "partial" | "missed" | "unknown";
export const ADHERENCE_STATUSES: readonly AdherenceStatus[] = ["taken", "partial", "missed", "unknown"];

export interface MedicationRecord {
  id: string;
  clientId: string;
  patientId: string;
  providerId: string | null;
  name: string;
  dosage: string | null;
  frequency: string;
  timesPerDay: number;
  instructions: string | null;
  startDate: number;
  endDate: number | null;
  status: MedicationStatus;
  createdAt: number;
  updatedAt: number;
}

export interface AdherenceRecord {
  id: string;
  clientId: string;
  patientId: string;
  medicationId: string;
  sessionId: string | null;
  status: AdherenceStatus;
  note: string | null;
  source: "call" | "doctor" | "patient";
  reportedAt: number;
}

export interface MedicationInput {
  name: string;
  dosage?: string | null;
  frequency?: string;
  timesPerDay?: number;
  instructions?: string | null;
  startDate?: number;
  endDate?: number | null;
}

const MED_COLUMNS =
  'id, "clientId", "patientId", "providerId", name, dosage, frequency, "timesPerDay", instructions, "startDate", "endDate", status, "createdAt", "updatedAt"';
const ADH_COLUMNS = 'id, "clientId", "patientId", "medicationId", "sessionId", status, note, source, "reportedAt"';

export async function listMedications(
  db: SupabaseClient,
  clientId: string,
  patientId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<MedicationRecord[]> {
  let q = db.from("medications").select(MED_COLUMNS).eq("clientId", clientId).eq("patientId", patientId);
  if (opts.activeOnly) q = q.eq("status", "active");
  const { data, error } = await q.order("createdAt", { ascending: false });
  if (error || !data) {
    if (error) console.error("[lib/db/medications] listMedications failed:", error.message);
    return [];
  }
  return data as unknown as MedicationRecord[];
}

export async function getMedication(db: SupabaseClient, clientId: string, medicationId: string): Promise<MedicationRecord | null> {
  const { data } = await db.from("medications").select(MED_COLUMNS).eq("clientId", clientId).eq("id", medicationId).maybeSingle();
  return (data as unknown as MedicationRecord) ?? null;
}

export async function addMedication(
  db: SupabaseClient,
  clientId: string,
  patientId: string,
  providerId: string | null,
  input: MedicationInput,
): Promise<MedicationRecord | null> {
  const now = Date.now();
  const row = {
    id: `med_${nanoid(10)}`,
    clientId,
    patientId,
    providerId,
    name: input.name.trim(),
    dosage: input.dosage?.trim() || null,
    frequency: input.frequency?.trim() || "once daily",
    timesPerDay: Math.min(6, Math.max(1, Math.round(input.timesPerDay ?? 1))),
    instructions: input.instructions?.trim() || null,
    startDate: input.startDate ?? now,
    endDate: input.endDate ?? null,
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
  };
  const { data, error } = await db.from("medications").insert(row).select(MED_COLUMNS).single();
  if (error || !data) {
    console.error("[lib/db/medications] addMedication failed:", error?.message);
    return null;
  }
  return data as unknown as MedicationRecord;
}

export async function setMedicationStatus(
  db: SupabaseClient,
  clientId: string,
  medicationId: string,
  status: MedicationStatus,
): Promise<MedicationRecord | null> {
  const { data, error } = await db
    .from("medications")
    .update({ status, updatedAt: Date.now(), ...(status !== "active" ? { endDate: Date.now() } : { endDate: null }) })
    .eq("clientId", clientId)
    .eq("id", medicationId)
    .select(MED_COLUMNS)
    .single();
  if (error || !data) return null;
  return data as unknown as MedicationRecord;
}

export async function recordAdherence(
  db: SupabaseClient,
  input: {
    clientId: string;
    patientId: string;
    medicationId: string;
    status: AdherenceStatus;
    note?: string | null;
    sessionId?: string | null;
    source?: "call" | "doctor" | "patient";
    reportedAt?: number;
  },
): Promise<AdherenceRecord | null> {
  // The medication must belong to this patient and hospital — a model-supplied id is never trusted.
  const med = await getMedication(db, input.clientId, input.medicationId);
  if (!med || med.patientId !== input.patientId) return null;

  const row = {
    id: `adh_${nanoid(10)}`,
    clientId: input.clientId,
    patientId: input.patientId,
    medicationId: input.medicationId,
    sessionId: input.sessionId ?? null,
    status: input.status,
    note: input.note?.trim().slice(0, 300) || null,
    source: input.source ?? "call",
    reportedAt: input.reportedAt ?? Date.now(),
  };
  // One report per medicine per call: a re-ask in the same call corrects the earlier answer instead of double counting.
  if (row.sessionId) {
    const { data: prior } = await db
      .from("medication_adherence")
      .select("id")
      .eq("clientId", row.clientId)
      .eq("medicationId", row.medicationId)
      .eq("sessionId", row.sessionId)
      .maybeSingle();
    if (prior) {
      const { data, error } = await db
        .from("medication_adherence")
        .update({ status: row.status, note: row.note, reportedAt: row.reportedAt })
        .eq("id", prior.id)
        .select(ADH_COLUMNS)
        .single();
      if (error || !data) return null;
      return data as unknown as AdherenceRecord;
    }
  }
  const { data, error } = await db.from("medication_adherence").insert(row).select(ADH_COLUMNS).single();
  if (error || !data) {
    console.error("[lib/db/medications] recordAdherence failed:", error?.message);
    return null;
  }
  return data as unknown as AdherenceRecord;
}

export async function listAdherence(
  db: SupabaseClient,
  clientId: string,
  patientId: string,
  sinceMs = Date.now() - 30 * 86_400_000,
): Promise<AdherenceRecord[]> {
  const { data, error } = await db
    .from("medication_adherence")
    .select(ADH_COLUMNS)
    .eq("clientId", clientId)
    .eq("patientId", patientId)
    .gte("reportedAt", sinceMs)
    .order("reportedAt", { ascending: false });
  if (error || !data) return [];
  return data as unknown as AdherenceRecord[];
}

// ── Pure adherence maths ─────────────────────────────────────────────────────

export interface MedicationAdherenceSummary {
  medicationId: string;
  name: string;
  dosage: string | null;
  frequency: string;
  /** 0-100, null when nothing was reported yet. taken=1, partial=0.5, missed=0; "unknown" is ignored. */
  adherencePct: number | null;
  reports: number;
  taken: number;
  partial: number;
  missed: number;
  /** Most recent consecutive "missed" reports. */
  missedStreak: number;
  lastStatus: AdherenceStatus | null;
  lastReportedAt: number | null;
  atRisk: boolean;
}

export interface PatientAdherenceSummary {
  overallPct: number | null;
  atRisk: boolean;
  medications: MedicationAdherenceSummary[];
}

/** Adherence at or below this over >= 3 reports, or two missed reports in a row, is "at risk". */
export const ADHERENCE_RISK_PCT = 60;

export function computeAdherence(meds: MedicationRecord[], logs: AdherenceRecord[]): PatientAdherenceSummary {
  const summaries: MedicationAdherenceSummary[] = meds
    .filter((m) => m.status === "active")
    .map((m) => {
      const mine = logs.filter((l) => l.medicationId === m.id && l.status !== "unknown").sort((a, b) => b.reportedAt - a.reportedAt);
      const taken = mine.filter((l) => l.status === "taken").length;
      const partial = mine.filter((l) => l.status === "partial").length;
      const missed = mine.filter((l) => l.status === "missed").length;
      let streak = 0;
      for (const l of mine) {
        if (l.status === "missed") streak++;
        else break;
      }
      const pct = mine.length ? Math.round(((taken + partial * 0.5) / mine.length) * 100) : null;
      const atRisk = streak >= 2 || (pct != null && mine.length >= 3 && pct <= ADHERENCE_RISK_PCT);
      return {
        medicationId: m.id,
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        adherencePct: pct,
        reports: mine.length,
        taken,
        partial,
        missed,
        missedStreak: streak,
        lastStatus: mine[0]?.status ?? null,
        lastReportedAt: mine[0]?.reportedAt ?? null,
        atRisk,
      };
    });

  const scored = summaries.filter((s) => s.adherencePct != null);
  const totalReports = scored.reduce((n, s) => n + s.reports, 0);
  const overallPct = totalReports
    ? Math.round(scored.reduce((n, s) => n + (s.adherencePct as number) * s.reports, 0) / totalReports)
    : null;
  return { overallPct, atRisk: summaries.some((s) => s.atRisk), medications: summaries };
}
