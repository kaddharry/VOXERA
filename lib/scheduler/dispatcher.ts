import { supabase } from "../db/supabase";
import { placeOutboundCall, isLocalBaseUrl } from "../telephony/outbound";
import { getPatientById } from "../db/patients";
import { decideNextStep, resolveWithinWindow, type RetryDecisionInput } from "./policy";
import { reconcileStuckCall, STUCK_CALL_TIMEOUT_MS } from "./stuck-calls";
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

  // Claims due "scheduled" tasks, plus "dispatching" tasks whose lease went
  // stale — a worker that crashed or restarted between claiming a task and
  // placing its call. Previously only "scheduled" rows were matched, so the
  // stale-lease recovery never actually ran and such a task stayed in
  // "dispatching" forever (and the UI won't let staff edit a task in that
  // state either).
  const { data: claimed, error } = await supabase
    .from("follow_up_tasks")
    .update({ status: "dispatching", claimedAt: now, claimedBy: WORKER_ID })
    .lte("nextAttemptAt", now)
    .or(
      `and(status.eq.scheduled,or(claimedAt.is.null,claimedAt.lt.${staleLeaseCutoff})),` +
        `and(status.eq.dispatching,claimedAt.lt.${staleLeaseCutoff})`,
    )
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

  const { callSid } = await placeOutboundCall({
    to: patient.phone,
    clientId: task.clientId,
    agentId,
    patientId: task.patientId,
    baseUrl,
  });

  await supabase
    .from("call_logs")
    .update({ followUpTaskId: task.id })
    .eq("id", callSid);

  await supabase
    .from("follow_up_tasks")
    .update({
      status: "calling",
      attemptCount: task.attemptCount + 1,
      // While "calling", claimedAt is when the call started and claimedBy
      // which call it is, so a call whose outcome never arrives can be
      // found later (reconcileStuckCalls). Only a task still "dispatching"
      // moves: an outcome that already arrived wins.
      claimedAt: Date.now(),
      claimedBy: `call:${callSid}`,
    })
    .eq("id", task.id)
    .eq("status", "dispatching");
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
      'id, "clientId", "patientId", status, timezone, "windowStartMinute", "windowEndMinute", "retryDelayMinutes", "finalAction", "attemptCount", "maxAttempts"',
    )
    .eq("id", input.taskId)
    .maybeSingle();
  if (!task) return;
  // Only a call in flight has an outcome to apply. Anything else means it
  // was already handled (a duplicate callback, or the stuck-call sweep got
  // there first) or staff changed it, and must not be moved again — e.g.
  // a retry flipping a cancelled task back to "scheduled".
  if (task.status !== "calling" && task.status !== "dispatching") return;
  // A callback can land before dispatchOne finished bumping attemptCount
  // (a call that failed within milliseconds); count that attempt here.
  const attemptCount = task.status === "dispatching" ? task.attemptCount + 1 : task.attemptCount;

  const decision = decideNextStep({
    twilioStatus: input.twilioStatus,
    followUpOutcome: input.followUpOutcome,
    attemptCount,
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
      .update({
        status: "scheduled",
        nextAttemptAt,
        attemptCount,
        lastOutcome: input.followUpOutcome ?? input.twilioStatus,
        claimedAt: null,
        claimedBy: null,
      })
      .eq("id", task.id)
      .eq("status", task.status);
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
      attemptCount,
      completedAt: finalStatus === "completed" ? Date.now() : null,
      lastOutcome: input.followUpOutcome ?? input.twilioStatus,
      claimedAt: null,
      claimedBy: null,
    })
    .eq("id", task.id)
    .eq("status", task.status);

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

/**
 * Finds follow-up tasks stuck in "calling" — their call started more than
 * STUCK_CALL_TIMEOUT_MS ago and no outcome ever arrived — and settles each
 * from its call_logs row: retry/complete like a normal outcome when the
 * call's end is on record, otherwise hand it to a human. Without this, a
 * single lost Twilio callback left the patient's follow-up "calling"
 * forever, with no retry and no alert.
 */
export async function reconcileStuckCalls(): Promise<number> {
  const cutoff = Date.now() - STUCK_CALL_TIMEOUT_MS;
  const { data: stuck, error } = await supabase
    .from("follow_up_tasks")
    .select('id, "clientId", "patientId"')
    .eq("status", "calling")
    .or(`claimedAt.is.null,claimedAt.lt.${cutoff}`)
    .limit(25);
  if (error || !stuck) return 0;

  for (const task of stuck) {
    try {
      const { data: call } = await supabase
        .from("call_logs")
        .select('id, "sessionId", status, summary, "startedAt"')
        .eq("followUpTaskId", task.id)
        .order("startedAt", { ascending: false })
        .limit(1)
        .maybeSingle();
      // Tasks moved to "calling" before claimedAt was stamped have no start
      // time on the task itself; go by the call's own start instead, so a
      // call that's genuinely still running isn't cut off.
      if (call?.startedAt && call.startedAt > cutoff) continue;

      const verdict = reconcileStuckCall(call ?? null);
      if ("needsReview" in verdict) {
        await markNeedsReview(task.id, task.clientId, task.patientId, verdict.needsReview, call ? { callId: call.id, sessionId: call.sessionId } : undefined);
      } else {
        await handleFollowUpCallOutcome({ taskId: task.id, ...verdict });
      }
    } catch (err) {
      console.error(`[Scheduler] Failed to reconcile stuck task ${task.id}:`, err);
    }
  }
  return stuck.length;
}

/** Starts the polling loop. Call once from custom-server.ts. */
export function startSchedulerPolling(intervalMs = 30_000) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
  if (!baseUrl) {
    console.warn("[Scheduler] NEXT_PUBLIC_BASE_URL not set — follow-up dispatch loop will not run.");
    return;
  }
  if (isLocalBaseUrl(baseUrl)) {
    // Twilio can't reach localhost, so every due task would be claimed,
    // fail and be released again every cycle. Leave them scheduled.
    console.warn(
      `[Scheduler] NEXT_PUBLIC_BASE_URL is ${baseUrl}, which Twilio can't reach — follow-up dispatch loop will not run. Use a public URL (e.g. ngrok) to test scheduled calls.`,
    );
    return;
  }

  // One cycle at a time: a slow cycle (25 calls, each a Twilio API round
  // trip) must not overlap the next tick.
  let running = false;
  let ticks = 0;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDispatchCycle(baseUrl);
      // Sweeping for lost callbacks doesn't need to run every 30s.
      if (ticks++ % 10 === 0) await reconcileStuckCalls();
    } catch (err) {
      console.error("[Scheduler] Dispatch cycle failed:", err);
    } finally {
      running = false;
    }
  }, intervalMs);
  console.log(`[Scheduler] Follow-up dispatch loop started (every ${intervalMs / 1000}s).`);
}
