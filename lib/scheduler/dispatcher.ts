import { supabase } from "../db/supabase";
import { placeOutboundCall, isLocalBaseUrl } from "../telephony/outbound";
import { getPatientById } from "../db/patients";
import type { FollowUpStatus } from "../db/follow-up-tasks";
import { decideNextStep, describeAttemptResult, resolveWithinWindow, type RetryDecisionInput } from "./policy";
import { CALL_CHECK_AFTER_MS, reconcileStuckCall } from "./stuck-calls";
import { hasPatientSpoken } from "../logging/session-logger";
import { fetchCallStatus } from "../telephony/twilio";

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
 * Applies the outcome of a follow-up call to its task. Called from
 * app/api/telephony/status/route.ts when a call ends (after the post-call
 * summary for a real conversation), and from the stuck-call sweep.
 *
 * Retries are timed from when the call actually ENDED (endedAt), not from
 * when this runs — the post-call summary can take a while, and a "retry
 * after 1 minute" means one minute after the call ended. The scheduler is
 * then woken for that exact time (requestSchedulerWake), so the retry
 * doesn't wait for the next 30-second poll.
 *
 * Idempotent: only a task still in flight ("calling", or "dispatching" if
 * the outcome beat the dispatcher's own update) is changed, and every
 * write re-checks that status, so a duplicate Twilio callback or a sweep
 * racing a late callback can't apply an outcome twice or use up an extra
 * attempt.
 */
export async function handleFollowUpCallOutcome(input: {
  taskId: string;
  twilioStatus: RetryDecisionInput["twilioStatus"];
  followUpOutcome?: RetryDecisionInput["followUpOutcome"];
  patientSpoke?: boolean;
  /** The patient asked on this call not to be called again. */
  doNotContactRequested?: boolean;
  /** When the call ended (ms). Defaults to now. */
  endedAt?: number;
}): Promise<void> {
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

  // Do-not-contact can also have been set by staff, or on another call.
  let doNotContact = input.doNotContactRequested === true;
  if (!doNotContact) {
    const { data: patient } = await supabase.from("patients").select('"doNotContact"').eq("id", task.patientId).maybeSingle();
    doNotContact = patient?.doNotContact === true;
  }

  const decision = decideNextStep({
    twilioStatus: input.twilioStatus,
    followUpOutcome: input.followUpOutcome,
    patientSpoke: input.patientSpoke,
    doNotContact,
    attemptCount,
    maxAttempts: task.maxAttempts,
  });
  const inFlight = task.status;

  if (decision.action === "cancelled") {
    await supabase
      .from("follow_up_tasks")
      .update({ status: "cancelled", cancelledAt: Date.now(), attemptCount, lastOutcome: "do_not_contact", claimedAt: null, claimedBy: null })
      .eq("id", task.id)
      .eq("status", inFlight);
    return;
  }

  if (decision.action === "retry") {
    const endedAt = input.endedAt ?? Date.now();
    const nextAttemptAt = resolveWithinWindow(endedAt + task.retryDelayMinutes * 60_000, {
      windowStartMinute: task.windowStartMinute ?? undefined,
      windowEndMinute: task.windowEndMinute ?? undefined,
      timezone: task.timezone,
    });
    const { data: moved } = await supabase
      .from("follow_up_tasks")
      .update({
        status: "scheduled",
        nextAttemptAt,
        attemptCount,
        lastOutcome: decision.result,
        claimedAt: null,
        claimedBy: null,
      })
      .eq("id", task.id)
      .eq("status", inFlight)
      .select("id");
    if (moved?.length) requestSchedulerWake(nextAttemptAt);
    return;
  }

  if (decision.action === "completed") {
    await supabase
      .from("follow_up_tasks")
      .update({ status: "completed", attemptCount, completedAt: Date.now(), lastOutcome: "resolved", claimedAt: null, claimedBy: null })
      .eq("id", task.id)
      .eq("status", inFlight);
    return;
  }

  // Exhausted: no attempts left today. Apply the task's final action.
  const finalStatus: FollowUpStatus =
    task.finalAction === "completed" ? "completed" : task.finalAction === "cancelled" ? "cancelled" : "exhausted";
  const { data: closed } = await supabase
    .from("follow_up_tasks")
    .update({
      status: finalStatus,
      attemptCount,
      completedAt: finalStatus === "completed" ? Date.now() : null,
      cancelledAt: finalStatus === "cancelled" ? Date.now() : null,
      lastOutcome: decision.result,
      claimedAt: null,
      claimedBy: null,
    })
    .eq("id", task.id)
    .eq("status", inFlight)
    .select("id");

  if (closed?.length && task.finalAction === "needs_review") {
    // The call that just ended is the one this is about — linked so the
    // alert opens its transcript, not just the patient.
    const { data: latestCall } = await supabase
      .from("call_logs")
      .select("id, sessionId")
      .eq("followUpTaskId", task.id)
      .order("startedAt", { ascending: false })
      .limit(1)
      .maybeSingle();
    await markNeedsReview(
      task.id,
      task.clientId,
      task.patientId,
      `All ${task.maxAttempts} attempt${task.maxAttempts === 1 ? "" : "s"} for the day were used without completing the follow-up (last result: ${describeAttemptResult(decision.result)}).`,
      latestCall ? { callId: latestCall.id, sessionId: latestCall.sessionId } : undefined,
    );
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
 * Finds follow-up tasks still "calling" after their call should have ended
 * and settles them (see lib/scheduler/stuck-calls.ts):
 * - the call's end is recorded but the task wasn't moved on → apply it;
 * - no end recorded → ask Twilio how the call actually went, and apply that;
 * - no way to find out after 2 hours → hand it to a human with an alert.
 * Runs about once a minute, so a lost status callback delays a retry by
 * minutes, not hours.
 */
export async function reconcileStuckCalls(): Promise<number> {
  const now = Date.now();
  const { data: stuck, error } = await supabase
    .from("follow_up_tasks")
    .select('id, "clientId", "patientId", "claimedAt", "claimedBy"')
    .eq("status", "calling")
    .or(`claimedAt.is.null,claimedAt.lt.${now - CALL_CHECK_AFTER_MS}`)
    .limit(25);
  if (error || !stuck) return 0;

  let settled = 0;
  for (const task of stuck) {
    try {
      const { data: call } = await supabase
        .from("call_logs")
        .select('id, "sessionId", status, summary, "startedAt", "endedAt"')
        .eq("followUpTaskId", task.id)
        .order("startedAt", { ascending: false })
        .limit(1)
        .maybeSingle();

      const base = { now, claimedAt: task.claimedAt ?? null, call: call ?? null };
      let verdict = reconcileStuckCall(base);
      if (verdict.kind === "ask_twilio") {
        const callSid = call?.id ?? (typeof task.claimedBy === "string" && task.claimedBy.startsWith("call:") ? task.claimedBy.slice(5) : null);
        const twilio = callSid ? await fetchCallStatus(callSid) : null;
        if (twilio && call && ["completed", "busy", "no-answer", "failed", "canceled"].includes(twilio.status)) {
          // Record what Twilio told us, as the lost callback would have.
          await supabase
            .from("call_logs")
            .update({
              status: twilio.status === "completed" ? "completed" : "failed",
              endedAt: twilio.endedAt ?? now,
              ...(twilio.durationSec != null && { durationMs: twilio.durationSec * 1000 }),
            })
            .eq("id", call.id);
        }
        verdict = reconcileStuckCall({ ...base, twilio: twilio ? { status: twilio.status, endedAt: twilio.endedAt } : null });
      }

      if (verdict.kind === "outcome") {
        const patientSpoke =
          verdict.twilioStatus === "completed" ? (call?.sessionId ? await hasPatientSpoken(call.sessionId) : false) : undefined;
        await handleFollowUpCallOutcome({
          taskId: task.id,
          twilioStatus: verdict.twilioStatus,
          followUpOutcome: verdict.followUpOutcome,
          patientSpoke,
          endedAt: verdict.endedAt,
        });
        settled++;
      } else if (verdict.kind === "needs_review") {
        await markNeedsReview(task.id, task.clientId, task.patientId, verdict.reason, call ? { callId: call.id, sessionId: call.sessionId } : undefined);
        settled++;
      }
    } catch (err) {
      console.error(`[Scheduler] Failed to reconcile stuck task ${task.id}:`, err);
    }
  }
  return settled;
}

/* ------------------------------------------------------------------ */
/* Polling and on-time wake-ups                                        */
/* ------------------------------------------------------------------ */

/**
 * Shared scheduler state. Kept on globalThis because the status-callback
 * route runs from Next.js's own bundled copy of this module, while the
 * loop is started from custom-server.ts's copy — both must reach the same
 * timer. One timer for the whole process (the next due task), never one
 * per patient; the database stays the source of truth, so nothing is lost
 * on restart: the poll picks everything up again.
 */
interface SchedulerState {
  baseUrl: string;
  intervalMs: number;
  running: boolean;
  rerun: boolean;
  wakeTimer: ReturnType<typeof setTimeout> | null;
  wakeAt: number | null;
  cycles: number;
}

const STATE_KEY = Symbol.for("voxera.scheduler.state");

function schedulerState(): SchedulerState | undefined {
  return (globalThis as Record<symbol, SchedulerState | undefined>)[STATE_KEY];
}

/** Runs one dispatch cycle unless one is already running (then runs again right after). */
async function runCycle(state: SchedulerState): Promise<void> {
  if (state.running) {
    state.rerun = true;
    return;
  }
  state.running = true;
  try {
    do {
      state.rerun = false;
      await runDispatchCycle(state.baseUrl);
      // The stuck-call sweep runs about once a minute.
      if (state.cycles++ % 2 === 0) await reconcileStuckCalls();
      await scheduleNextWake(state);
    } while (state.rerun);
  } catch (err) {
    console.error("[Scheduler] Dispatch cycle failed:", err);
  } finally {
    state.running = false;
  }
}

/** Arms the wake timer for the earliest scheduled task (initial calls as well as retries). */
async function scheduleNextWake(state: SchedulerState): Promise<void> {
  const { data } = await supabase
    .from("follow_up_tasks")
    .select('"nextAttemptAt"')
    .eq("status", "scheduled")
    .gt("nextAttemptAt", Date.now())
    .order("nextAttemptAt", { ascending: true })
    .limit(1);
  const next = data?.[0]?.nextAttemptAt as number | undefined;
  if (next) armWake(state, next);
}

/** Wake-ups further out than this are left to the regular poll, which re-arms them as they get close. */
const MAX_WAKE_AHEAD_MS = 15 * 60 * 1000;

function armWake(state: SchedulerState, at: number): void {
  const now = Date.now();
  if (at - now > MAX_WAKE_AHEAD_MS) return;
  if (state.wakeTimer && state.wakeAt !== null && state.wakeAt <= at) return;
  if (state.wakeTimer) clearTimeout(state.wakeTimer);
  state.wakeAt = at;
  state.wakeTimer = setTimeout(() => {
    state.wakeTimer = null;
    state.wakeAt = null;
    void runCycle(state);
  }, Math.max(0, at - now) + 250); // small margin so the task is due when the cycle reads it
  state.wakeTimer.unref?.();
}

/**
 * Asks the scheduler to run a dispatch cycle at `at`, so a task due before
 * the next 30-second poll (e.g. a one-minute retry) is called on time.
 * A no-op in a process where the scheduler isn't running (`npm run dev`).
 */
export function requestSchedulerWake(at: number): void {
  const state = schedulerState();
  if (state) armWake(state, at);
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
  if (schedulerState()) return; // already running in this process

  const state: SchedulerState = { baseUrl, intervalMs, running: false, rerun: false, wakeTimer: null, wakeAt: null, cycles: 0 };
  (globalThis as Record<symbol, SchedulerState | undefined>)[STATE_KEY] = state;
  setInterval(() => void runCycle(state), intervalMs);
  void runCycle(state);
  console.log(`[Scheduler] Follow-up dispatch loop started (every ${intervalMs / 1000}s, plus on-time wake-ups for tasks due sooner).`);
}

/** Test helper: forget the shared scheduler state. */
export function __resetSchedulerForTests(): void {
  const state = schedulerState();
  if (state?.wakeTimer) clearTimeout(state.wakeTimer);
  delete (globalThis as Record<symbol, SchedulerState | undefined>)[STATE_KEY];
}

/** Test helper: install scheduler state without starting the interval. */
export function __installSchedulerForTests(baseUrl: string, intervalMs = 30_000): SchedulerState {
  const state: SchedulerState = { baseUrl, intervalMs, running: false, rerun: false, wakeTimer: null, wakeAt: null, cycles: 0 };
  (globalThis as Record<symbol, SchedulerState | undefined>)[STATE_KEY] = state;
  return state;
}
