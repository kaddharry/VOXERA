import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { getPatientById } from "./patients";

/**
 * Shared DB access for patient_documents (migration_v17.sql) — the
 * per-patient document list that replaced patients.notes being the only
 * place an uploaded file's text could live. notes is now the manually-typed
 * free-text field only; every uploaded file becomes its own row here,
 * preserving each one instead of overwriting the last.
 */

export interface PatientDocumentRecord {
  id: string;
  patientId: string;
  clientId: string;
  filename: string;
  mimeType: string | null;
  extractedText: string;
  createdAt: number;
}

const DOCUMENT_COLUMNS = 'id, "patientId", "clientId", filename, "mimeType", "extractedText", "createdAt"';

export async function listPatientDocuments(
  db: SupabaseClient,
  patientId: string,
  clientId: string,
): Promise<PatientDocumentRecord[]> {
  const { data, error } = await db
    .from("patient_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("patientId", patientId)
    .eq("clientId", clientId)
    .order("createdAt", { ascending: false });
  if (error || !data) return [];
  return data as unknown as PatientDocumentRecord[];
}

export async function createPatientDocument(
  db: SupabaseClient,
  clientId: string,
  fields: { patientId: string; filename: string; mimeType?: string | null; extractedText: string },
): Promise<PatientDocumentRecord | null> {
  const { data, error } = await db
    .from("patient_documents")
    .insert({
      id: nanoid(12),
      patientId: fields.patientId,
      clientId,
      filename: fields.filename,
      mimeType: fields.mimeType ?? null,
      extractedText: fields.extractedText,
      createdAt: Date.now(),
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[lib/db/patient-documents] createPatientDocument failed:", error?.message);
    return null;
  }
  return data as unknown as PatientDocumentRecord;
}

export async function deletePatientDocument(
  db: SupabaseClient,
  documentId: string,
  clientId: string,
): Promise<boolean> {
  const { error } = await db
    .from("patient_documents")
    .delete()
    .eq("id", documentId)
    .eq("clientId", clientId);
  if (error) {
    console.error("[lib/db/patient-documents] deletePatientDocument failed:", error.message);
    return false;
  }
  return true;
}

/**
 * Builds the full PATIENT CONTEXT text for a call: the patient's manual
 * `notes` plus every uploaded document's extracted text, concatenated.
 * Unscoped by clientId (same "trusted server-side caller" reasoning as
 * getPatientById) — this is what lib/agent/orchestrator.ts resolves per
 * call, replacing its old `patientInfo?.notes`-only lookup.
 */
export async function getPatientCallContext(db: SupabaseClient, patientId: string): Promise<string | undefined> {
  const [patient, { data: docs }, { data: appts }, { data: calls }] = await Promise.all([
    getPatientById(db, patientId),
    db
      .from("patient_documents")
      .select('filename, "extractedText"')
      .eq("patientId", patientId)
      .order("createdAt", { ascending: true }),
    db
      .from("appointments")
      .select("starts_at, status, visit_type, provider_id")
      .eq("patient_id", patientId)
      .gte("starts_at", new Date().toISOString())
      .not("status", "in", "(cancelled,no_show)")
      .order("starts_at", { ascending: true })
      .limit(3),
    db
      .from("call_logs")
      .select('"startedAt", summary')
      .eq("patientId", patientId)
      .not("summary", "is", null)
      .order("startedAt", { ascending: false })
      .limit(3),
  ]);

  const parts: string[] = [];
  if (patient) {
    const profile = [`Patient: ${patient.name}`];
    if (patient.condition) profile.push(`condition: ${patient.condition}`);
    profile.push(`risk level: ${patient.riskLevel}`);
    parts.push(profile.join(", "));
  }
  if (patient?.notes?.trim()) parts.push(patient.notes.trim());
  for (const doc of docs ?? []) {
    if (doc.extractedText?.trim()) parts.push(doc.extractedText.trim());
  }
  if (appts && appts.length > 0) {
    const fmt = (iso: string) =>
      new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
    parts.push("Upcoming appointments:\n" + appts.map((a: any) => `- ${fmt(a.starts_at)} (${a.visit_type}, ${a.status})`).join("\n"));
  }
  const past = (calls ?? [])
    .map((c: any) => {
      const sum = c.summary as { sentimentTrajectory?: string; flaggedConcerns?: string[]; recommendedAction?: string } | null;
      if (!sum) return null;
      const bits = [sum.sentimentTrajectory, sum.flaggedConcerns?.length ? `concerns: ${sum.flaggedConcerns.join("; ")}` : "", sum.recommendedAction ? `next: ${sum.recommendedAction}` : ""].filter(Boolean);
      return `- ${new Date(c.startedAt).toLocaleDateString("en-IN")}: ${bits.join(" | ")}`;
    })
    .filter(Boolean);
  if (past.length > 0) parts.push("Previous calls with this patient (most recent first):\n" + past.join("\n"));
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
