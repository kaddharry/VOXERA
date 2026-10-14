import type { SupabaseClient } from "@supabase/supabase-js";

/** Shared DB access for alerts (migration_v18.sql) — the human-review /
 * "Needs Attention" queue entity (spec §16.10). */

export interface AlertRecord {
  id: string;
  clientId: string;
  patientId: string | null;
  followUpTaskId: string | null;
  callId: string | null;
  sessionId: string | null;
  reason: string;
  priority: "low" | "normal" | "high";
  status: "open" | "resolved";
  createdAt: number;
  resolvedAt: number | null;
  resolutionNotes: string | null;
}

const ALERT_COLUMNS =
  'id, "clientId", "patientId", "followUpTaskId", "callId", "sessionId", reason, priority, status, "createdAt", "resolvedAt", "resolutionNotes"';

export async function listAlerts(
  db: SupabaseClient,
  clientId: string,
  status: "open" | "resolved" | "all" = "open",
  patientId?: string,
): Promise<AlertRecord[]> {
  let query = db.from("alerts").select(ALERT_COLUMNS).eq("clientId", clientId);
  if (status !== "all") query = query.eq("status", status);
  if (patientId) query = query.eq("patientId", patientId);
  const { data, error } = await query.order("createdAt", { ascending: false });
  if (error || !data) return [];
  return data as unknown as AlertRecord[];
}

/**
 * Creates an open, high-priority alert from a live-call escalation (see
 * lib/agent/orchestrator.ts's policy.escalate branch) — fire-and-forget by
 * design, same as the logSessionEvent call it sits next to, since a failed
 * alert write shouldn't affect the live call turn.
 */
export async function createEscalationAlert(
  db: SupabaseClient,
  input: { clientId: string; patientId: string | null; sessionId: string; reason: string },
): Promise<void> {
  const { error } = await db.from("alerts").insert({
    id: `alert_esc_${input.sessionId}_${Date.now()}`,
    clientId: input.clientId,
    patientId: input.patientId,
    sessionId: input.sessionId,
    reason: input.reason,
    priority: "high",
    createdAt: Date.now(),
  });
  if (error) console.error("[lib/db/alerts] createEscalationAlert failed:", error.message);
}

export async function resolveAlert(
  db: SupabaseClient,
  alertId: string,
  clientId: string,
  resolutionNotes?: string,
): Promise<AlertRecord | null> {
  const { data, error } = await db
    .from("alerts")
    .update({ status: "resolved", resolvedAt: Date.now(), resolutionNotes: resolutionNotes ?? null })
    .eq("id", alertId)
    .eq("clientId", clientId)
    .select(ALERT_COLUMNS)
    .single();
  if (error || !data) return null;
  return data as unknown as AlertRecord;
}
