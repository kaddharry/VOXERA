import { learnFromCall } from "../learning";
import { supabase } from "../db/supabase";
import { generateCallSummary } from "../agent/call-summary";
import { applyCallMedicationReports } from "../agent/adherence";
import { listMedications } from "../db/medications";
import { analyzeCall, saveCallInsights } from "../insights/analyze-call";
import { hasPatientSpoken } from "../logging/session-logger";
import { handleFollowUpCallOutcome, applyDoNotContactRequest, readAnsweredBy } from "../scheduler/dispatcher";
import { applyAppointmentCallOutcome } from "../scheduler/appointment-reminders";
import type { TwilioCallStatus } from "../scheduler/policy";
import { updateDemoRequestStatusByCallSid } from "../db/demo-requests";
import type { BackgroundJob } from "../jobs/background-jobs";

/**
 * After-call work for one call, run as a durable background job
 * (kind "post_call", key "post_call:<CallSid>"): the doctor-facing summary,
 * the follow-up retry decision, appointment outcomes and the self-learning
 * findings. Enqueued by Twilio's status callback (app/api/telephony/status),
 * run there straight away, and retried by the cron if that run didn't finish.
 *
 * Safe to run more than once: the follow-up decision ignores a task that's
 * already settled, an existing summary is reused instead of regenerated, and
 * the findings for a call replace its previous ones.
 */

export const POST_CALL_JOB = "post_call";

export interface PostCallPayload {
  callSid: string;
  callStatus: string;
  /** Twilio CallStatus mapped to our call_logs status (completed | failed). */
  outcome: "completed" | "failed";
  endedAt: number;
  followUpTaskId: string | null;
  attempt?: number;
  answeredBy?: string | null;
}

export function postCallJobKey(callSid: string): string {
  return `${POST_CALL_JOB}:${callSid}`;
}

export async function runPostCallJob(job: BackgroundJob): Promise<void> {
  const p = job.payload as unknown as PostCallPayload;
  const { callSid } = p;
  const identity = { callSid, ...(p.attempt && { attempt: p.attempt }) };

  const { data: call, error } = await supabase
    .from("call_logs")
    .select('sessionId, clientId, patientId, "agentId", "followUpTaskId", summary')
    .eq("id", callSid)
    .maybeSingle();
  if (error) throw new Error(`Reading call_logs failed: ${error.message}`);

  const followUpTaskId = (call?.followUpTaskId as string | null) ?? p.followUpTaskId;
  const answeredBy = followUpTaskId ? (p.answeredBy || (await readAnsweredBy(callSid))) : undefined;

  if (!call) {
    // No call record yet means the call never got as far as the audio
    // stream, so nobody spoke even if Twilio says "completed".
    if (followUpTaskId) {
      await handleFollowUpCallOutcome({
        taskId: followUpTaskId,
        twilioStatus: p.callStatus as TwilioCallStatus,
        patientSpoke: p.callStatus === "completed" ? false : undefined,
        answeredBy: answeredBy ?? undefined,
        endedAt: p.endedAt,
        ...identity,
      });
    }
    return;
  }

  // Public Book-a-Demo calls always carry clientId "demo".
  if (call.clientId === "demo") {
    await updateDemoRequestStatusByCallSid(supabase, callSid, p.outcome === "completed" ? "completed" : "failed").catch((err) =>
      console.error(`[PostCall] Demo request sync failed for ${callSid}:`, err),
    );
  }

  // Twilio reports "completed" for ANY call that connected (voicemail, an
  // instant hang-up, a stream that never started); whether the patient
  // actually spoke is what separates a real conversation from those.
  const connected = p.outcome === "completed";
  const patientSpoke = connected ? (call.sessionId ? await hasPatientSpoken(call.sessionId) : false) : undefined;
  const machineAnswered = !!answeredBy && (answeredBy === "fax" || answeredBy.startsWith("machine_"));

  const settleFollowUp = (outcome: { followUpOutcome?: "resolved" | "needs_retry" | "needs_review"; doNotContactRequested?: boolean }) =>
    followUpTaskId
      ? handleFollowUpCallOutcome({
          taskId: followUpTaskId,
          twilioStatus: p.callStatus as TwilioCallStatus,
          patientSpoke,
          answeredBy: answeredBy ?? undefined,
          endedAt: p.endedAt,
          ...identity,
          ...outcome,
        })
      : Promise.resolve();

  const summarise = connected && call.sessionId && call.patientId && !(followUpTaskId && (patientSpoke === false || machineAnswered));
  if (!summarise) {
    // Never connected, or connected without the patient speaking: the
    // outcome is known from the call itself, so a retry is scheduled at once.
    await settleFollowUp({});
    return;
  }

  let summary: Awaited<ReturnType<typeof generateCallSummary>>;
  try {
    // Reuse a summary an earlier attempt of this job already saved.
    // The prescribed medicines go to the summary so it can report what the patient said about each.
    const medications = call.summary ? [] : await listMedications(supabase, call.clientId, call.patientId, { activeOnly: true }).catch(() => []);
    summary = (call.summary as typeof summary) ?? (await generateCallSummary(call.sessionId, call.clientId, { medications }));
  } catch (err) {
    // Unclear outcome: let the scheduler retry the follow-up now, and let
    // this job retry the summary later.
    await settleFollowUp({});
    throw err;
  }
  if (!summary) {
    await settleFollowUp({});
    return;
  }
  if (!call.summary) await supabase.from("call_logs").update({ summary }).eq("id", callSid);

  // Medicine answers given on the call -> the adherence log (skips anything the agent already recorded live).
  if (summary.medicationReports?.length) {
    await applyCallMedicationReports(supabase, {
      clientId: call.clientId,
      patientId: call.patientId,
      sessionId: call.sessionId,
      reports: summary.medicationReports,
    }).catch((err) => console.error(`[PostCall] applyCallMedicationReports failed for ${callSid}:`, err));
  }

  if (summary.requestedDoNotContact && call.patientId) {
    await applyDoNotContactRequest(call.clientId, call.patientId, "Patient asked to stop being called (detected from call transcript).");
  }
  await settleFollowUp({ followUpOutcome: summary.followUpOutcome, doNotContactRequested: summary.requestedDoNotContact });

  // Reminder-call outcome -> the appointment/waitlist entry it was about
  // (no-op for an ordinary follow-up call). After settleFollowUp so it can
  // never delay the scheduler's own retry decision.
  if (followUpTaskId) {
    await applyAppointmentCallOutcome(supabase, {
      taskId: followUpTaskId,
      sessionId: call.sessionId,
      appointmentConfirmed: summary.appointmentConfirmed,
      appointmentCancelRequested: summary.appointmentCancelRequested,
    }).catch((err) => console.error(`[PostCall] applyAppointmentCallOutcome failed for ${callSid}:`, err));
  }

  // Self-learning pipeline: knowledge gaps and emotional failure points.
  const insights = await analyzeCall(call.sessionId, call.clientId);
  if (insights) {
    await saveCallInsights({
      callSid,
      sessionId: call.sessionId,
      clientId: call.clientId,
      patientId: call.patientId,
      summary: summary as unknown as Record<string, unknown>,
      insights,
    });
  }

  // What the agents learn from this call — patient facts, agent and global
  // lessons (lib/learning). Best-effort and idempotent per call; never fails the job.
  await learnFromCall({
    sessionId: call.sessionId,
    callId: callSid,
    clientId: call.clientId,
    agentId: (call.agentId as string | null) ?? null,
    patientId: call.patientId,
  }).catch((err) => console.error(`[PostCall] learnFromCall failed for ${callSid}:`, err));
}
