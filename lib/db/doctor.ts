import type { SupabaseClient } from "@supabase/supabase-js";
import { LOW_PRIORITY_THRESHOLD } from "../agent/triage";
import type { PatientRecord } from "./patients";
import { computeAdherence, listAdherence, listMedications } from "./medications";
import { listReferrals } from "./referrals";
import { listAlerts } from "./alerts";
import { listInstructionRequests } from "./instruction-requests";

/**
 * Everything a doctor may see is derived from ONE rule — "my patients":
 *   • patients whose primaryProviderId is me,
 *   • patients who have (or had) an appointment with me,
 *   • patients another doctor referred to me and I haven't declined.
 * Every /api/doctor/* route resolves the doctor's providerId from their login (lib/auth/access.ts)
 * and scopes through this file; a patient id from the browser is only ever checked against this rule.
 */

export interface DoctorScope {
  clientId: string;
  tenantId: string;
  providerId: string;
}

const PATIENT_COLUMNS =
  'id, "clientId", name, phone, notes, "assignedAgentId", "nextCheckInAt", "createdAt", "doNotContact", "condition", "riskLevel", "primaryProviderId"';
const PATIENT_COLUMNS_FALLBACK =
  'id, "clientId", name, phone, notes, "assignedAgentId", "nextCheckInAt", "createdAt", "doNotContact", "condition", "riskLevel"';

type Res = { data: unknown; error: { code?: string } | null };

export type DoctorPatient = Pick<
  PatientRecord,
  "id" | "name" | "phone" | "notes" | "condition" | "riskLevel" | "doNotContact" | "nextCheckInAt" | "createdAt" | "assignedAgentId"
> & { primaryProviderId?: string | null; relation: "primary" | "appointment" | "referral" };

/** ids of every patient this doctor is allowed to see, with why. */
export async function myPatientIds(db: SupabaseClient, scope: DoctorScope): Promise<Map<string, DoctorPatient["relation"]>> {
  const out = new Map<string, DoctorPatient["relation"]>();

  const primary = await db.from("patients").select("id").eq("clientId", scope.clientId).eq("primaryProviderId", scope.providerId);
  // 42703 = migration_v37 not applied yet: fall through to appointments/referrals only.
  for (const r of (primary.data ?? []) as { id: string }[]) out.set(r.id, "primary");

  const appts = await db.from("appointments").select("patient_id").eq("client_id", scope.clientId).eq("provider_id", scope.providerId);
  for (const r of (appts.data ?? []) as { patient_id: string }[]) if (!out.has(r.patient_id)) out.set(r.patient_id, "appointment");

  const refs = await db
    .from("referrals")
    .select('"patientId", status')
    .eq("clientId", scope.clientId)
    .eq("to_provider_id", scope.providerId)
    .in("status", ["pending", "accepted", "completed"]);
  for (const r of (refs.data ?? []) as { patientId: string }[]) if (!out.has(r.patientId)) out.set(r.patientId, "referral");

  return out;
}

export async function isMyPatient(db: SupabaseClient, scope: DoctorScope, patientId: string): Promise<boolean> {
  return (await myPatientIds(db, scope)).has(patientId);
}

export async function listMyPatients(db: SupabaseClient, scope: DoctorScope): Promise<DoctorPatient[]> {
  const ids = await myPatientIds(db, scope);
  if (ids.size === 0) return [];
  let res: Res = await db.from("patients").select(PATIENT_COLUMNS).eq("clientId", scope.clientId).in("id", [...ids.keys()]);
  if (res.error?.code === "42703") res = await db.from("patients").select(PATIENT_COLUMNS_FALLBACK).eq("clientId", scope.clientId).in("id", [...ids.keys()]);
  const rows = (res.data ?? []) as unknown as Omit<DoctorPatient, "relation">[];
  return rows.map((p) => ({ ...p, relation: ids.get(p.id)! })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getMyPatient(db: SupabaseClient, scope: DoctorScope, patientId: string): Promise<DoctorPatient | null> {
  const ids = await myPatientIds(db, scope);
  if (!ids.has(patientId)) return null;
  let res: Res = await db.from("patients").select(PATIENT_COLUMNS).eq("clientId", scope.clientId).eq("id", patientId).maybeSingle();
  if (res.error?.code === "42703") res = await db.from("patients").select(PATIENT_COLUMNS_FALLBACK).eq("clientId", scope.clientId).eq("id", patientId).maybeSingle();
  if (!res.data) return null;
  return { ...(res.data as unknown as Omit<DoctorPatient, "relation">), relation: ids.get(patientId)! };
}

// ── Appointments, ranked ─────────────────────────────────────────────────────

export interface DoctorAppointment {
  id: string;
  patient_id: string;
  provider_id: string;
  starts_at: string;
  ends_at: string;
  visit_type: string;
  status: string;
  notes: string | null;
  booked_via: string;
  severity: "routine" | "moderate" | "serious" | "emergency";
  severity_reason: string | null;
  priority_score: number;
  cancel_reason: string | null;
  patientName?: string;
  /** Flagged for the doctor: low importance AND competing with a more important visit. */
  lowPriority: boolean;
  /** Why it is flagged, e.g. "Routine visit; 2 more serious patients are booked the same day". */
  lowPriorityNote: string | null;
}

export function normalizeAppointment<T extends Record<string, unknown>>(row: T): T & { severity: DoctorAppointment["severity"]; priority_score: number; severity_reason: string | null } {
  return {
    ...row,
    severity: ((row.severity as DoctorAppointment["severity"] | undefined) ?? "routine") as DoctorAppointment["severity"],
    priority_score: (row.priority_score as number | undefined) ?? 20,
    severity_reason: (row.severity_reason as string | null | undefined) ?? null,
  };
}

const dayKey = (iso: string) => iso.slice(0, 10);

/**
 * Marks appointments the doctor can consider cancelling. An appointment is "low priority" when its score is
 * below LOW_PRIORITY_THRESHOLD AND it is not alone: the same day holds at least one more important booking
 * (so freeing it makes room for someone who needs it more). Pure — unit tested.
 */
export function flagLowPriority(
  appointments: Array<Pick<DoctorAppointment, "id" | "starts_at" | "priority_score" | "status" | "severity">>,
): Map<string, string> {
  const active = appointments.filter((a) => !["cancelled", "no_show", "completed"].includes(a.status));
  const byDay = new Map<string, typeof active>();
  for (const a of active) byDay.set(dayKey(a.starts_at), [...(byDay.get(dayKey(a.starts_at)) ?? []), a]);

  const flagged = new Map<string, string>();
  for (const a of active) {
    if (a.priority_score >= LOW_PRIORITY_THRESHOLD) continue;
    const moreImportant = (byDay.get(dayKey(a.starts_at)) ?? []).filter((o) => o.id !== a.id && o.priority_score >= a.priority_score + 20);
    if (moreImportant.length > 0) {
      flagged.set(a.id, `${a.severity === "routine" ? "Routine" : "Low-priority"} visit; ${moreImportant.length} more important ${moreImportant.length === 1 ? "patient is" : "patients are"} booked the same day.`);
    }
  }
  return flagged;
}

export async function listMyAppointments(
  db: SupabaseClient,
  scope: DoctorScope,
  range: { from: string; to: string },
): Promise<DoctorAppointment[]> {
  const { data, error } = await db
    .from("appointments")
    .select("*")
    .eq("client_id", scope.clientId)
    .eq("provider_id", scope.providerId)
    .lt("starts_at", range.to)
    .gt("ends_at", range.from)
    .order("starts_at", { ascending: true });
  if (error || !data) return [];
  const rows = (data as Record<string, unknown>[]).map(normalizeAppointment) as unknown as DoctorAppointment[];

  const patientIds = [...new Set(rows.map((r) => r.patient_id))];
  const names = new Map<string, string>();
  if (patientIds.length) {
    const { data: ps } = await db.from("patients").select("id, name").eq("clientId", scope.clientId).in("id", patientIds);
    for (const p of (ps ?? []) as { id: string; name: string }[]) names.set(p.id, p.name);
  }
  const flags = flagLowPriority(rows);
  return rows.map((r) => ({ ...r, patientName: names.get(r.patient_id) ?? "Unknown patient", lowPriority: flags.has(r.id), lowPriorityNote: flags.get(r.id) ?? null }));
}

export async function getMyAppointment(db: SupabaseClient, scope: DoctorScope, appointmentId: string) {
  const { data } = await db
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .eq("client_id", scope.clientId)
    .eq("provider_id", scope.providerId)
    .maybeSingle();
  return data ? (normalizeAppointment(data as Record<string, unknown>) as unknown as DoctorAppointment & { tenant_id: string; client_id: string }) : null;
}

// ── Patient detail + overview ────────────────────────────────────────────────

export interface PainPoint {
  at: number;
  callId: string;
  present: boolean;
  location: string | null;
  score: number | null;
  description: string | null;
}

export async function getPatientDetailForDoctor(db: SupabaseClient, scope: DoctorScope, patientId: string) {
  const patient = await getMyPatient(db, scope, patientId);
  if (!patient) return null;

  const [callsRes, medications, logs, appts, alerts, referrals, instructions] = await Promise.all([
    db
      .from("call_logs")
      .select('id, "sessionId", status, "startedAt", "endedAt", "durationMs", summary')
      .eq("clientId", scope.clientId)
      .eq("patientId", patientId)
      .order("startedAt", { ascending: false })
      .limit(15),
    listMedications(db, scope.clientId, patientId),
    listAdherence(db, scope.clientId, patientId, Date.now() - 60 * 86_400_000),
    db.from("appointments").select("*").eq("client_id", scope.clientId).eq("patient_id", patientId).order("starts_at", { ascending: false }).limit(20),
    listAlerts(db, scope.clientId, "all", patientId),
    listReferrals(db, scope.clientId, { patientId }),
    listInstructionRequests(db, scope.clientId, { status: "all" }),
  ]);

  const calls = ((callsRes.data ?? []) as Array<{ id: string; sessionId: string | null; status: string; startedAt: number | null; endedAt: number | null; durationMs: number | null; summary: Record<string, any> | null }>);
  const pain: PainPoint[] = calls
    .filter((c) => c.summary)
    .map((c) => {
      const p = c.summary!.painReported as Partial<PainPoint> | undefined;
      return { at: c.startedAt ?? 0, callId: c.id, present: !!p?.present, location: p?.location ?? null, score: p?.score ?? null, description: p?.description ?? null };
    })
    .reverse();

  const adherence = computeAdherence(medications, logs);
  const myAppts = ((appts.data ?? []) as Record<string, unknown>[]).map(normalizeAppointment).filter((a) => a.provider_id === scope.providerId);

  return {
    patient,
    calls: calls.map((c) => ({
      id: c.id,
      startedAt: c.startedAt,
      durationMs: c.durationMs,
      status: c.status,
      summary: c.summary
        ? {
            sentimentTrajectory: c.summary.sentimentTrajectory ?? null,
            flaggedConcerns: c.summary.flaggedConcerns ?? [],
            recommendedAction: c.summary.recommendedAction ?? null,
            painReported: c.summary.painReported ?? null,
            callEmotion: c.summary.callEmotion ?? null,
          }
        : null,
    })),
    pain,
    medications,
    adherence,
    recentAdherence: logs.slice(0, 40),
    appointments: myAppts,
    alerts: alerts.filter((a) => a.status === "open").slice(0, 20),
    referrals,
    instructions: instructions.filter((i) => i.patientId === patientId || (i.patientId == null && i.provider_id === scope.providerId)),
  };
}

export async function getDoctorOverview(db: SupabaseClient, scope: DoctorScope, now = new Date()) {
  const patients = await listMyPatients(db, scope);
  const ids = patients.map((p) => p.id);

  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const weekEnd = new Date(dayStart.getTime() + 7 * 86_400_000);

  const [appointments, referralsIn, requests, alertsAll, medsAll, logsAll] = await Promise.all([
    listMyAppointments(db, scope, { from: dayStart.toISOString(), to: weekEnd.toISOString() }),
    listReferrals(db, scope.clientId, { providerId: scope.providerId, direction: "incoming", status: "pending" }),
    listInstructionRequests(db, scope.clientId, { providerId: scope.providerId, status: "pending" }),
    listAlerts(db, scope.clientId, "open"),
    ids.length ? db.from("medications").select('id, "patientId", name, status, dosage, frequency, "timesPerDay", instructions, "startDate", "endDate", "createdAt", "updatedAt", "clientId", "providerId"').eq("clientId", scope.clientId).in("patientId", ids) : Promise.resolve({ data: [] }),
    ids.length ? db.from("medication_adherence").select('id, "patientId", "medicationId", status, "reportedAt", note, source, "sessionId", "clientId"').eq("clientId", scope.clientId).in("patientId", ids).gte("reportedAt", Date.now() - 30 * 86_400_000) : Promise.resolve({ data: [] }),
  ]);

  const idSet = new Set(ids);
  const myAlerts = alertsAll.filter((a) => a.patientId && idSet.has(a.patientId));
  const patientName = new Map(patients.map((p) => [p.id, p.name]));

  const medsByPatient = new Map<string, any[]>();
  for (const m of (medsAll.data ?? []) as any[]) medsByPatient.set(m.patientId, [...(medsByPatient.get(m.patientId) ?? []), m]);
  const logsByPatient = new Map<string, any[]>();
  for (const l of (logsAll.data ?? []) as any[]) logsByPatient.set(l.patientId, [...(logsByPatient.get(l.patientId) ?? []), l]);

  const adherenceRisks = patients
    .map((p) => ({ patient: p, summary: computeAdherence(medsByPatient.get(p.id) ?? [], logsByPatient.get(p.id) ?? []) }))
    .filter((x) => x.summary.atRisk)
    .map((x) => ({
      patientId: x.patient.id,
      patientName: x.patient.name,
      overallPct: x.summary.overallPct,
      medications: x.summary.medications.filter((m) => m.atRisk).map((m) => ({ name: m.name, missedStreak: m.missedStreak, adherencePct: m.adherencePct })),
    }));

  const active = appointments.filter((a) => !["cancelled", "no_show", "completed"].includes(a.status));
  const todayKey = dayKey(now.toISOString());
  return {
    counts: {
      patients: patients.length,
      today: active.filter((a) => dayKey(a.starts_at) === todayKey).length,
      thisWeek: active.length,
      openAlerts: myAlerts.length,
      adherenceRisks: adherenceRisks.length,
      pendingReferrals: referralsIn.length,
      pendingRequests: requests.length,
      lowPriority: active.filter((a) => a.lowPriority).length,
    },
    upcoming: active.slice(0, 8),
    alerts: myAlerts.slice(0, 8).map((a) => ({ ...a, patientName: a.patientId ? patientName.get(a.patientId) ?? "Unknown patient" : "Unknown patient" })),
    adherenceRisks: adherenceRisks.slice(0, 8),
    referralsIn: referralsIn.slice(0, 5),
  };
}
