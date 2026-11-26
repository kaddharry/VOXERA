import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeAdherence,
  listAdherence,
  listMedications,
  recordAdherence,
  type AdherenceRecord,
  type AdherenceStatus,
} from "../db/medications";
import type { MedicationReport } from "./call-summary";

/**
 * Records what a patient said about a medicine and, if it shows a pattern (two misses in a row, or
 * low adherence over several reports), raises ONE open alert per patient+medicine so the doctor sees it.
 */
export async function recordAdherenceAndCheck(
  db: SupabaseClient,
  input: {
    clientId: string;
    patientId: string;
    medicationId: string;
    status: AdherenceStatus;
    note?: string | null;
    sessionId?: string | null;
    source?: "call" | "doctor" | "patient";
  },
): Promise<{ record: AdherenceRecord; atRisk: boolean } | null> {
  const record = await recordAdherence(db, input);
  if (!record) return null;

  const [meds, logs] = await Promise.all([
    listMedications(db, input.clientId, input.patientId, { activeOnly: true }),
    listAdherence(db, input.clientId, input.patientId),
  ]);
  const summary = computeAdherence(meds, logs).medications.find((m) => m.medicationId === input.medicationId);
  const atRisk = !!summary?.atRisk;
  if (atRisk && summary) {
    await raiseAdherenceAlert(db, {
      clientId: input.clientId,
      patientId: input.patientId,
      medicationId: input.medicationId,
      sessionId: input.sessionId ?? null,
      reason: `Medication adherence: ${summary.name} — ${
        summary.missedStreak >= 2 ? `missed ${summary.missedStreak} reports in a row` : `only ${summary.adherencePct}% taken over ${summary.reports} reports`
      }`,
    });
  }
  return { record, atRisk };
}

/** One open alert per patient+medicine; a resolved one re-opens if the pattern continues. */
export async function raiseAdherenceAlert(
  db: SupabaseClient,
  input: { clientId: string; patientId: string; medicationId: string; sessionId: string | null; reason: string },
): Promise<void> {
  const id = `alert_adherence_${input.patientId}_${input.medicationId}`;
  const { data: existing } = await db.from("alerts").select("status").eq("id", id).maybeSingle();
  if (!existing) {
    const { error } = await db.from("alerts").insert({
      id,
      clientId: input.clientId,
      patientId: input.patientId,
      sessionId: input.sessionId,
      reason: input.reason,
      priority: "normal",
      createdAt: Date.now(),
    });
    if (error) console.error("[adherence] alert insert failed:", error.message);
    return;
  }
  if (existing.status === "resolved") {
    await db.from("alerts").update({ status: "open", resolvedAt: null, reason: input.reason }).eq("id", id);
  } else {
    await db.from("alerts").update({ reason: input.reason }).eq("id", id);
  }
}

/** Applies the post-call summary's medication findings. A report the agent already recorded live
 * (record_medication_adherence) for the same call is left alone. */
export async function applyCallMedicationReports(
  db: SupabaseClient,
  input: { clientId: string; patientId: string; sessionId: string; reports: MedicationReport[] },
): Promise<number> {
  let applied = 0;
  for (const report of input.reports) {
    const { data: already } = await db
      .from("medication_adherence")
      .select("id")
      .eq("clientId", input.clientId)
      .eq("medicationId", report.medicationId)
      .eq("sessionId", input.sessionId)
      .maybeSingle();
    if (already) continue;
    const result = await recordAdherenceAndCheck(db, {
      clientId: input.clientId,
      patientId: input.patientId,
      medicationId: report.medicationId,
      status: report.status,
      note: report.note,
      sessionId: input.sessionId,
      source: "call",
    });
    if (result) applied++;
  }
  return applied;
}
