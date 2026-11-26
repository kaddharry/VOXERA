import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeAdherence,
  listAdherence,
  listMedications,
  type MedicationAdherenceSummary,
  type MedicationRecord,
  type AdherenceRecord,
} from "../db/medications";
import type { PainReport } from "./call-summary";

/**
 * What the agent should carry into a call beyond "who is this patient":
 *   1. the pain (and any concern) the patient reported on the LAST call — the agent opens by asking how it is now;
 *   2. the medicines the doctor prescribed, with the latest adherence — the agent asks about them one at a time;
 *   3. instructions a doctor wrote for the agent that a hospital admin APPROVED (never unapproved ones).
 *
 * Built once per call (cached 30s per patient) and placed in the system prompt as grounding, not as a
 * way to override the core rules.
 */

export interface LastCallSnapshot {
  endedAt: number | null;
  startedAt: number | null;
  pain: PainReport | null;
  concerns: string[];
}

export interface ApprovedInstruction {
  id: string;
  title: string;
  instruction: string;
  /** true = written for this patient; false = a doctor's standing instruction for all their patients. */
  patientSpecific: boolean;
  doctorName: string | null;
}

export interface CarePlanInput {
  lastCall: LastCallSnapshot | null;
  medications: MedicationRecord[];
  adherence: MedicationAdherenceSummary[];
  instructions: ApprovedInstruction[];
}

export function describeAge(ts: number | null, now = Date.now()): string {
  if (!ts) return "earlier";
  const hours = Math.max(0, Math.round((now - ts) / 3_600_000));
  if (hours < 20) return "earlier today";
  const days = Math.round(hours / 24);
  if (days <= 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

function painLine(pain: PainReport): string {
  const where = pain.location ? ` in the ${pain.location.replace(/^(the|my)\s+/i, "")}` : "";
  const score = pain.score != null ? `, about ${pain.score}/10` : "";
  const detail = pain.description ? ` ("${pain.description}")` : "";
  return `pain${where}${score}${detail}`;
}

export function formatCarePlan(input: CarePlanInput, now = Date.now()): string {
  const out: string[] = [];

  const last = input.lastCall;
  if (last && (last.pain?.present || last.concerns.length > 0)) {
    const when = describeAge(last.endedAt ?? last.startedAt, now);
    out.push("LAST CALL (" + when + "):");
    if (last.pain?.present) {
      out.push(
        `- The patient reported ${painLine(last.pain)}. START this call by asking, in your own words and ONE short question, how that pain is now — better, the same or worse. ` +
          "Do this before anything else unless they raise something urgent. Ask it only once per call; if the STM shows you already asked, don't repeat it.",
      );
    }
    for (const c of last.concerns.slice(0, 3)) out.push(`- Concern flagged then: ${c}`);
    if (last.pain?.present) {
      out.push("- If it is worse, or they describe severe pain, take it seriously: say the care team will look at it today and offer to book a visit with the book_appointment tool (severity \"serious\") — the system checks that the situation is genuinely serious.");
    }
  } else if (last) {
    out.push(`LAST CALL (${describeAge(last.endedAt ?? last.startedAt, now)}): no pain or concern was reported. Don't invent one; a simple "how have you been since we last spoke?" is enough.`);
  }

  const meds = input.medications.filter((m) => m.status === "active");
  if (meds.length > 0) {
    const byId = new Map(input.adherence.map((a) => [a.medicationId, a]));
    out.push("MEDICATIONS prescribed by the doctor (ask about them naturally, ONE per turn, never read the whole list):");
    for (const m of meds.slice(0, 8)) {
      const a = byId.get(m.id);
      const status = a?.lastStatus
        ? ` — last reported: ${a.lastStatus}${a.lastReportedAt ? ` (${describeAge(a.lastReportedAt, now)})` : ""}${a.atRisk ? " ⚠ often missed" : ""}`
        : " — not asked yet";
      out.push(`- ${m.name}${m.dosage ? ` ${m.dosage}` : ""}, ${m.frequency}${m.instructions ? ` (${m.instructions})` : ""}${status} [id=${m.id}]`);
    }
    out.push(
      "After the patient answers about a medicine, call record_medication_adherence with its id and taken / partial / missed (or unknown if they didn't say). " +
        "If a medicine is often missed, ask kindly what gets in the way. Never advise changing a dose or stopping a medicine; for side effects or " +
        "wanting to stop, tell them to speak to their doctor and the team will follow up.",
    );
  }

  if (input.instructions.length > 0) {
    out.push("DOCTOR'S INSTRUCTIONS FOR THIS CALL (approved by the hospital — follow them, within the safety rules):");
    for (const i of input.instructions.slice(0, 5)) {
      out.push(`- ${i.doctorName ? `${i.doctorName}: ` : ""}${i.instruction}${i.patientSpecific ? "" : " (all this doctor's patients)"}`);
    }
  }

  return out.length > 0 ? ["=== CARE PLAN ===", ...out].join("\n") : "";
}

// ── I/O ──────────────────────────────────────────────────────────────────────

interface CallLogRow {
  summary: { flaggedConcerns?: unknown; painReported?: PainReport } | null;
  startedAt: number | null;
  endedAt: number | null;
}

export async function loadLastCall(db: SupabaseClient, clientId: string, patientId: string): Promise<LastCallSnapshot | null> {
  const { data } = await db
    .from("call_logs")
    .select("summary, startedAt, endedAt")
    .eq("clientId", clientId)
    .eq("patientId", patientId)
    .not("summary", "is", null)
    .order("startedAt", { ascending: false })
    .limit(1);
  const row = (data as unknown as CallLogRow[] | null)?.[0];
  if (!row?.summary) return null;
  const pain = row.summary.painReported;
  return {
    startedAt: row.startedAt ?? null,
    endedAt: row.endedAt ?? null,
    pain: pain && typeof pain === "object" && pain.present === true ? pain : null,
    concerns: Array.isArray(row.summary.flaggedConcerns) ? row.summary.flaggedConcerns.filter((c): c is string => typeof c === "string") : [],
  };
}

/** Approved doctor instructions that apply to this patient. Pending/rejected/withdrawn never appear. */
export async function loadApprovedInstructions(
  db: SupabaseClient,
  clientId: string,
  patientId: string,
  primaryProviderId: string | null,
): Promise<ApprovedInstruction[]> {
  const { data, error } = await db
    .from("agent_instruction_requests")
    .select('id, title, proposed_instruction, "patientId", provider_id')
    .eq("clientId", clientId)
    .eq("status", "approved");
  if (error || !data) return [];
  const rows = data as unknown as Array<{ id: string; title: string; proposed_instruction: string; patientId: string | null; provider_id: string }>;
  const applicable = rows.filter((r) => r.patientId === patientId || (r.patientId == null && !!primaryProviderId && r.provider_id === primaryProviderId));
  if (applicable.length === 0) return [];
  const { data: providers } = await db.from("providers").select("id, name").in("id", [...new Set(applicable.map((r) => r.provider_id))]);
  const nameById = new Map(((providers ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  return applicable.map((r) => ({
    id: r.id,
    title: r.title,
    instruction: r.proposed_instruction,
    patientSpecific: r.patientId === patientId,
    doctorName: nameById.get(r.provider_id) ?? null,
  }));
}

export async function buildCarePlanContext(db: SupabaseClient, input: { clientId: string; patientId: string }): Promise<string> {
  const { clientId, patientId } = input;
  const patientRow = await Promise.resolve(db.from("patients").select('"primaryProviderId"').eq("id", patientId).maybeSingle()).catch(() => ({ data: null }));
  const primaryProviderId = ((patientRow.data as { primaryProviderId?: string | null } | null)?.primaryProviderId as string | null | undefined) ?? null;

  const [lastCall, medications, logs, instructions] = await Promise.all([
    loadLastCall(db, clientId, patientId).catch(() => null),
    listMedications(db, clientId, patientId, { activeOnly: true }).catch((): MedicationRecord[] => []),
    listAdherence(db, clientId, patientId).catch((): AdherenceRecord[] => []),
    loadApprovedInstructions(db, clientId, patientId, primaryProviderId).catch((): ApprovedInstruction[] => []),
  ]);
  const adherence = computeAdherence(medications, logs).medications;
  return formatCarePlan({ lastCall, medications, adherence, instructions });
}
