import { supabase } from "../db/supabase";
import { placeOutboundCall, isLocalBaseUrl } from "../telephony/outbound";
import { getPatientById } from "../db/patients";
import { decideNextStep, resolveWithinWindow, type RetryDecisionInput } from "./policy";
import type { FollowUpStatus } from "../db/follow-up-tasks";

const DISPATCH_LEASE_MS = 2 * 60 * 1000; // a claimed-but-undispatched task is reclaimable after this
const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * One poll cycle: claim every due follow_up_tasks row and place its call.
 * Called on an interval from custom-server.ts — the only long-lived Node
 * process this app has (see that file's own doc comment on why `next
 * start` alone can't host this kind of background work either).
 *
 * Idempotency: the UPDATE below is the compare-and-swap. PostgREST executes
 * it as one SQL UPDATE ... WHERE ... RETURNING statement, so of any number
 * of workers (or overlapping poll ticks) racing to claim the same row,
 * Postgres's own row-level locking guarantees exactly one UPDATE succeeds
 * per row — the others' WHERE clause simply matches zero rows by the time
 * their statement runs, rather than racing in application code.
 */
export async function runDispatchCycle(baseUrl: string): Promise<{ dispatched: number; errors: number }> {
  const now = Date.now();
  const staleLeaseCutoff = now - DISPATCH_LEASE_MS;

  const { data: claimed, error } = await supabase
    .from("follow_up_tasks")
    .update({ status: "dispatching", claimedAt: now, claimedBy: WORKER_ID })
    .in("status", ["scheduled"])
    .lte("nextAttemptAt", now)
    .or(`claimedAt.is.null,claimedAt.lt.${staleLeaseCutoff}`)
    .select('id, "patientId", "clientId", "agentId", "attemptCount"')
    .limit(25);

  if (error) {
    console.error("[Scheduler] Failed to claim due tasks:", error.message);
    return { dispatched: 0, errors: 1 };
  }
  if (!claimed || claimed.length === 0) return { dispatched: 0, errors: 0 };

  let dispatched = 0;
  let errors = 0;

  for (const task of claimed) {
    try {
      await dispatchOne(task, baseUrl);
      dispatched++;
    } catch (err) {
      console.error(`[Scheduler] Dispatch failed for task ${task.id}:`, err);
      errors++;
      // Release the lease so the next cycle retries it, rather than
      // leaving it stuck in "dispatching" until the lease TTL expires.
      await supabase.from("follow_up_tasks").update({ status: "scheduled", claimedAt: null, claimedBy: null }).eq("id", task.id);
    }
  }

  return { dispatched, errors };
}

async function dispatchOne(
  task: { id: string; patientId: string; clientId: string; agentId: string | null; attemptCount: number },
  baseUrl: string,
) {
  if (isLocalBaseUrl(baseUrl)) {
    // Matches /api/telephony/outbound's own guard — a scheduled call is
    // just as unreachable from Twilio as a manual one over plain localhost.
    throw new Error("Scheduler cannot place calls without a public base URL (set NEXT_PUBLIC_BASE_URL).");
  }

  const patient = await getPatientById(supabase, task.patientId);
  if (!patient) throw new Error(`Patient ${task.patientId} not found`);

  // Consent/do-not-contact enforcement (spec §17.4) — checked here, at the
  // one place every scheduled dispatch funnels through, not just hidden in
  // the UI. Cancels the task outright rather than retrying later; a
  // do-not-contact patient doesn't get called again at all, ever, until
  // staff explicitly clears the flag.
  if (patient.doNotContact) {
    await supabase
      .from("follow_up_tasks")
      .update({ status: "cancelled", cancelledAt: Date.now(), lastOutcome: "do_not_contact", claimedAt: null, claimedBy: null })
      .eq("id", task.id);
    return;
  }

  const agentId = task.agentId ?? patient.assignedAgentId ?? undefined;
  if (!agentId) {
    // No call was ever placed for this attempt, so there's nothing to link
    // the alert back to.
    await markNeedsReview(task.id, task.clientId, task.patientId, "No agent assigned to this follow-up or the patient.");
    return;
  }

  // followUpTaskId goes into the call_logs insert and the Twilio status
  // callback URL itself, so the outcome can always be tied back to this
  // task — even when a call fails so fast that Twilio's callback arrives
  // before the call_logs row exists (the old follow-up update here ran
  // after the call was placed, too late for that case).
  const { callSid } = await placeOutboundCall({
    to: patient.phone,
    clientId: task.clientId,
    agentId,
    patientId: task.patientId,
    followUpTaskId: task.id,
    baseUrl,
  });
  console.log(`[Scheduler] Placed follow-up call ${callSid} for task ${task.id}.`);

  await supabase
    .from("follow_up_tasks")
    .update({ status: "calling", attemptCount: task.attemptCount + 1, claimedAt: null, claimedBy: null })
    .eq("id", task.id);
}

async function markNeedsReview(
  taskId: string,
  clientId: string,
  patientId: string,
  reason: string,
  call?: { callId: string | null; sessionId: string | null },
) {
  await supabase.from("follow_up_tasks").update({ status: "needs_review", lastOutcome: reason, claimedAt: null, claimedBy: null }).eq("id", taskId);
  await supabase.from("alerts").insert({
    id: `alert_${taskId}_${Date.now()}`,
    clientId,
    patientId,
    followUpTaskId: taskId,
    callId: call?.callId ?? null,
    sessionId: call?.sessionId ?? null,
    reason,
    priority: "normal",
    createdAt: Date.now(),
  });
}

/**
 * Called from app/api/telephony/status/route.ts once a call tied to a
 * follow-up task has ended AND (for a connected call) its post-call summary
 * has resolved — so the retry/completion decision always has the best
 * signal available, never just "the call ended."
 */
export async function handleFollowUpCallOutcome(input: {
  taskId: string;
  twilioStatus: RetryDecisionInput["twilioStatus"];
  followUpOutcome?: RetryDecisionInput["followUpOutcome"];
}) {
  const { data: task } = await supabase
    .from("follow_up_tasks")
    .select(
      'id, "clientId", "patientId", timezone, "windowStartMinute", "windowEndMinute", "retryDelayMinutes", "finalAction", "attemptCount", "maxAttempts"',
    )
    .eq("id", input.taskId)
    .maybeSingle();
  if (!task) return;

  const decision = decideNextStep({
    twilioStatus: input.twilioStatus,
    followUpOutcome: input.followUpOutcome,
    attemptCount: task.attemptCount,
    maxAttempts: task.maxAttempts,
  });
  const terminalStatus: Record<string, FollowUpStatus> = {
    completed: "completed",
    exhausted: task.finalAction === "completed" ? "completed" : task.finalAction === "cancelled" ? "cancelled" : "exhausted",
  };

  if (decision.action === "retry") {
    const candidateAt = Date.now() + task.retryDelayMinutes * 60_000;
    const nextAttemptAt = resolveWithinWindow(candidateAt, {
      windowStartMinute: task.windowStartMinute ?? undefined,
      windowEndMinute: task.windowEndMinute ?? undefined,
      timezone: task.timezone,
    });
    await supabase
      .from("follow_up_tasks")
      .update({ status: "scheduled", nextAttemptAt, lastOutcome: input.followUpOutcome ?? input.twilioStatus })
      .eq("id", task.id);
    return;
  }

  // The call that just ended is the one this review/exhaustion decision is
  // about — looked up once here (by followUpTaskId, set in dispatchOne) so
  // both "needs_review" branches below can link the alert straight to its
  // transcript instead of only the patient it belongs to.
  const { data: latestCall } = await supabase
    .from("call_logs")
    .select("id, sessionId")
    .eq("followUpTaskId", task.id)
    .order("startedAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  const callRef = latestCall ? { callId: latestCall.id, sessionId: latestCall.sessionId } : undefined;

  if (decision.action === "needs_review") {
    await markNeedsReview(task.id, task.clientId, task.patientId, decision.reason, callRef);
    return;
  }

  // "completed" or "exhausted" — both terminal, no further attempts.
  const finalStatus = terminalStatus[decision.action];
  await supabase
    .from("follow_up_tasks")
    .update({
      status: finalStatus,
      completedAt: finalStatus === "completed" ? Date.now() : null,
      lastOutcome: input.followUpOutcome ?? input.twilioStatus,
    })
    .eq("id", task.id);

  if (finalStatus === "exhausted" && task.finalAction === "needs_review") {
    await markNeedsReview(task.id, task.clientId, task.patientId, "All scheduled attempts exhausted without reaching the patient.", callRef);
  }
}

/**
 * Applies a just-detected do-not-contact request (spec §17.4): flags the
 * patient and cancels every one of their still-pending follow-up tasks
 * immediately, rather than letting an already-scheduled retry slip through
 * before anyone notices the flag. Called from app/api/telephony/status/
 * route.ts when the post-call summary's requestedDoNotContact is true.
 */
export async function applyDoNotContactRequest(clientId: string, patientId: string, reason: string): Promise<void> {
  await supabase
    .from("patients")
    .update({ doNotContact: true, doNotContactAt: Date.now(), doNotContactReason: reason })
    .eq("id", patientId)
    .eq("clientId", clientId);

  await supabase
    .from("follow_up_tasks")
    .update({ status: "cancelled", cancelledAt: Date.now(), lastOutcome: "do_not_contact" })
    .eq("patientId", patientId)
    .eq("clientId", clientId)
    .in("status", ["scheduled", "paused"]);
}

/** Starts the polling loop. Call once from custom-server.ts. */
export function startSchedulerPolling(intervalMs = 30_000) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
  if (!baseUrl) {
    console.warn("[Scheduler] NEXT_PUBLIC_BASE_URL not set — follow-up dispatch loop will not run.");
    return;
  }
  setInterval(() => {
    runDispatchCycle(baseUrl).catch((err) => console.error("[Scheduler] Dispatch cycle failed:", err));
  }, intervalMs);
  console.log(`[Scheduler] Follow-up dispatch loop started (every ${intervalMs / 1000}s).`);
}
