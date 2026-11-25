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

const PRIORITY_RANK = { low: 0, normal: 1, high: 2 } as const;
/** One write at a time per call, so two alerts from the same turn can't both insert. */
const callAlertQueue = new Map<string, Promise<void>>();

/**
 * ONE alert per call. Before, a single distressed turn wrote two rows (the
 * policy escalation and the emotion classifier's "Caller sounded pain"), and a
 * frustrated caller added a new row every turn. Now the first problem in a call
 * creates the alert; later ones update the same row: a new kind of problem is
 * added to the reason, and the priority only ever goes up. If staff already
 * resolved it and something new happens later in the same call, it re-opens.
 *
 * `kind` is the short headline ("Caller in pain", "Escalation (human)") used to
 * tell a repeat from a new problem.
 */
export function raiseCallAlert(
  db: SupabaseClient,
  input: { clientId: string; patientId: string | null; sessionId: string; kind: string; detail: string; priority: AlertRecord["priority"] },
): Promise<void> {
  const prev = callAlertQueue.get(input.sessionId) ?? Promise.resolve();
  const next = prev.then(() => writeCallAlert(db, input)).catch((err) => {
    console.error("[lib/db/alerts] raiseCallAlert failed:", err instanceof Error ? err.message : err);
  });
  callAlertQueue.set(input.sessionId, next);
  void next.finally(() => {
    if (callAlertQueue.get(input.sessionId) === next) callAlertQueue.delete(input.sessionId);
  });
  return next;
}

export function mergeAlertReason(existing: string, kind: string, detail: string): string {
  if (existing.includes(kind)) return existing;
  const merged = `${existing} · ${kind}: ${detail}`;
  return merged.length > 600 ? `${merged.slice(0, 597)}...` : merged;
}

async function writeCallAlert(
  db: SupabaseClient,
  input: { clientId: string; patientId: string | null; sessionId: string; kind: string; detail: string; priority: AlertRecord["priority"] },
): Promise<void> {
  const id = `alert_call_${input.sessionId}`;
  const { data: existing } = await db.from("alerts").select("reason, priority, status").eq("id", id).maybeSingle();
  if (!existing) {
    const { error } = await db.from("alerts").insert({
      id,
      clientId: input.clientId,
      patientId: input.patientId,
      sessionId: input.sessionId,
      reason: `${input.kind}: ${input.detail}`,
      priority: input.priority,
      createdAt: Date.now(),
    });
    if (error) console.error("[lib/db/alerts] raiseCallAlert insert failed:", error.message);
    return;
  }
  const oldPriority = existing.priority as AlertRecord["priority"];
  const priority = PRIORITY_RANK[input.priority] > PRIORITY_RANK[oldPriority] ? input.priority : oldPriority;
  const reason = mergeAlertReason(existing.reason as string, input.kind, input.detail);
  const isNew = reason !== existing.reason || priority !== oldPriority;
  if (!isNew) return; // same problem again in the same call: nothing to change
  const reopen = existing.status === "resolved";
  const { error } = await db
    .from("alerts")
    .update({ reason, priority, ...(reopen ? { status: "open", resolvedAt: null } : {}) })
    .eq("id", id);
  if (error) console.error("[lib/db/alerts] raiseCallAlert update failed:", error.message);
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
