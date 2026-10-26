import type { RetryDecisionInput, TwilioCallStatus } from "./policy";

/**
 * How long a follow-up may sit in "calling" before the dispatcher stops
 * waiting for Twilio's status callback and reconciles it. Real calls end
 * long before this; a task still "calling" after it means the callback was
 * lost (webhook down, server restarted mid-call, a callback that arrived
 * before the call was recorded).
 */
export const STUCK_CALL_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/**
 * For a follow-up stuck in "calling", decides what its call actually did
 * from the call_logs row (if one exists). Returns the input for the normal
 * outcome handling, or a needs_review reason when the outcome can't be
 * known. Pure, so it's unit-testable without a database.
 */
export function reconcileStuckCall(
  call: { status: string | null; summary?: { followUpOutcome?: RetryDecisionInput["followUpOutcome"] } | null } | null,
): { twilioStatus: TwilioCallStatus; followUpOutcome?: RetryDecisionInput["followUpOutcome"] } | { needsReview: string } {
  if (!call) {
    return { needsReview: "A follow-up call was started but no call record or outcome was ever received." };
  }
  if (call.status === "failed") return { twilioStatus: "failed" };
  if (call.status === "completed") {
    return { twilioStatus: "completed", followUpOutcome: call.summary?.followUpOutcome };
  }
  return { needsReview: "A follow-up call never reported how it ended (status callback missing)." };
}
