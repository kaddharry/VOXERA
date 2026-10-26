import type { RetryDecisionInput, TwilioCallStatus } from "./policy";

/**
 * Recovering follow-up calls whose outcome never arrived.
 *
 * Normally Twilio POSTs a status callback when a call ends and
 * app/api/telephony/status/route.ts moves the task on. If that callback is
 * lost (our server restarted, the webhook failed) or its processing
 * failed, the task would sit in "calling" indefinitely. The dispatcher's
 * sweep (reconcileStuckCalls) checks such tasks every minute and uses
 * this pure function to decide what to do.
 */

/** Don't look at a call younger than this — it may simply still be in progress. */
export const CALL_CHECK_AFTER_MS = 3 * 60 * 1000;

/** A call that ended this long ago but whose task is still "calling" means
 * the outcome handling after the callback didn't finish. */
export const ENDED_GRACE_MS = 2 * 60 * 1000;

/** Give up and ask a human after this long with no way to learn the outcome. */
export const STUCK_CALL_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const TERMINAL_TWILIO_STATUSES: ReadonlySet<string> = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);

export type StuckVerdict =
  | { kind: "outcome"; twilioStatus: TwilioCallStatus; followUpOutcome?: RetryDecisionInput["followUpOutcome"]; endedAt: number }
  | { kind: "ask_twilio" }
  | { kind: "needs_review"; reason: string }
  | { kind: "wait" };

export function reconcileStuckCall(input: {
  now: number;
  /** When the task started calling (follow_up_tasks.claimedAt), if known. */
  claimedAt: number | null;
  /** The call's call_logs row, if one exists. */
  call: {
    status: string | null;
    startedAt: number | null;
    endedAt: number | null;
    summary?: { followUpOutcome?: RetryDecisionInput["followUpOutcome"] } | null;
  } | null;
  /** Twilio's own view of the call, once asked (fetchCallStatus); undefined = not asked yet. */
  twilio?: { status: string; endedAt: number | null } | null;
}): StuckVerdict {
  const { now, call, twilio } = input;
  const startedAt = call?.startedAt ?? input.claimedAt ?? 0;
  if (now - startedAt < CALL_CHECK_AFTER_MS) return { kind: "wait" };

  // The callback did arrive (call_logs has its end) but the task wasn't moved on.
  if (call?.endedAt && (call.status === "completed" || call.status === "failed")) {
    if (now - call.endedAt < ENDED_GRACE_MS) return { kind: "wait" };
    return {
      kind: "outcome",
      twilioStatus: call.status === "completed" ? "completed" : "failed",
      followUpOutcome: call.summary?.followUpOutcome,
      endedAt: call.endedAt,
    };
  }

  // No record of the end: ask Twilio how the call actually went.
  if (twilio === undefined) return { kind: "ask_twilio" };
  if (twilio && TERMINAL_TWILIO_STATUSES.has(twilio.status)) {
    return { kind: "outcome", twilioStatus: twilio.status as TwilioCallStatus, endedAt: twilio.endedAt ?? now };
  }

  if (now - startedAt >= STUCK_CALL_TIMEOUT_MS) {
    return {
      kind: "needs_review",
      reason: call
        ? "A follow-up call never reported how it ended (status callback missing)."
        : "A follow-up call was started but no call record or outcome was ever received.",
    };
  }
  // Twilio says it's still ringing/in progress, or couldn't be reached: check again later.
  return { kind: "wait" };
}
