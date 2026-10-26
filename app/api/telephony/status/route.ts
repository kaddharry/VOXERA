import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../lib/db/supabase";
import { generateCallSummary } from "../../../../lib/agent/call-summary";
import { hasPatientSpoken } from "../../../../lib/logging/session-logger";
import { handleFollowUpCallOutcome, applyDoNotContactRequest, readAnsweredBy } from "../../../../lib/scheduler/dispatcher";
import type { TwilioCallStatus } from "../../../../lib/scheduler/policy";
import { updateDemoRequestStatusByCallSid } from "../../../../lib/db/demo-requests";

export const dynamic = "force-dynamic";

/**
 * POST /api/telephony/status
 *
 * Twilio status callback — called when a call changes status
 * (completed, busy, no-answer, failed, etc.)
 *
 * Configure this as the "Status Callback URL" in Twilio console or
 * when initiating outbound calls.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const params = Object.fromEntries(new URLSearchParams(body));

    const callSid = params.CallSid;
    const callStatus = params.CallStatus; // completed | busy | no-answer | failed | canceled
    const callDuration = params.CallDuration; // seconds (Twilio provides this on completion)

    console.log(`[Telephony/Status] CallSid=${callSid}, status=${callStatus}, duration=${callDuration}s`);

    if (!callSid) {
      return NextResponse.json({ error: "Missing CallSid" }, { status: 400 });
    }

    const statusMap: Record<string, string> = {
      completed: "completed",
      busy: "failed",
      "no-answer": "failed",
      failed: "failed",
      canceled: "failed",
    };

    // When the call ended: Twilio sends this callback the moment it does.
    // Follow-up retries are timed from here, not from whenever the
    // post-call summary below finishes.
    const endedAt = Date.now();
    const updates: Record<string, unknown> = {
      status: statusMap[callStatus] || "completed",
      endedAt,
    };

    if (callDuration) {
      updates.durationMs = parseInt(callDuration, 10) * 1000;
    }

    const { data: updatedCall, error } = await supabase
      .from("call_logs")
      .update(updates)
      .eq("id", callSid)
      .select('sessionId, clientId, patientId, "followUpTaskId"')
      .maybeSingle();

    // Scheduled follow-up calls carry their task id on this callback's URL
    // (lib/telephony/outbound.ts). That's what lets the outcome still reach
    // the task when there's no call_logs row yet — a call that failed
    // within milliseconds can finish before placeOutboundCall has written
    // it, and that failure used to be dropped here, leaving the follow-up
    // stuck in "calling" with no retry.
    const followUpTaskId = updatedCall?.followUpTaskId ?? req.nextUrl.searchParams.get("followUpTaskId");
    // Which attempt this call was (sent on the callback URL by the
    // dispatcher), so a late callback from an earlier attempt can't be
    // applied to a newer one.
    const attemptParam = Number(req.nextUrl.searchParams.get("followUpAttempt"));
    const identity = {
      callSid,
      ...(Number.isInteger(attemptParam) && attemptParam > 0 && { attempt: attemptParam }),
    };
    // Voicemail detection verdict, recorded by /api/telephony/amd before
    // it hung up on a machine (Twilio may also include it here).
    const answeredBy = followUpTaskId ? (params.AnsweredBy || (await readAnsweredBy(callSid))) : undefined;

    if (error || !updatedCall) {
      if (error) console.error("[Telephony/Status] DB update failed:", error);
      if (followUpTaskId) {
        // No call record yet means the call never got as far as the audio
        // stream, so nobody spoke even if Twilio says "completed".
        await handleFollowUpCallOutcome({
          taskId: followUpTaskId,
          twilioStatus: callStatus as TwilioCallStatus,
          patientSpoke: callStatus === "completed" ? false : undefined,
          answeredBy,
          endedAt,
          ...identity,
        }).catch((err) => console.error(`[Telephony/Status] Follow-up outcome handling failed for ${callSid}:`, err));
      } else if (error && !req.nextUrl.searchParams.get("campaignCallId")) {
        return NextResponse.json({ error: "DB update failed" }, { status: 500 });
      }
      // Fall through: a campaign call's own row still gets its outcome below.
    } else {
      // Public Book-a-Demo calls (spec §5) always carry clientId "demo" — see
      // app/api/demo-requests/[id]/call/route.ts. Keep its status in sync so
      // /book-demo/confirm's poll can show the right next step.
      if (updatedCall?.clientId === "demo") {
        updateDemoRequestStatusByCallSid(supabase, callSid, updates.status === "completed" ? "completed" : "failed").catch((err) =>
          console.error(`[Telephony/Status] Demo request sync failed for ${callSid}:`, err),
        );
      }

      // Twilio reports "completed" for ANY call that connected — voicemail,
      // a patient hanging up straight away, or a call whose audio stream
      // never started included. Whether the patient actually spoke (from the
      // saved transcript) is what separates a real conversation from those.
      const connected = updates.status === "completed";
      const patientSpoke = connected ? (updatedCall?.sessionId ? await hasPatientSpoken(updatedCall.sessionId) : false) : undefined;

      // Post-call LLM-judge summary for the doctor to review — only for calls
      // that actually completed with a real transcript (not busy/no-answer/
      // failed, and not a follow-up call where the patient never spoke),
      // and only ones placed against a roster patient. Fire-and-forget:
      // this webhook's job is confirming Twilio's status update was
      // recorded, not waiting on an LLM call — and the call has already
      // ended by this point, so there's no live turn this could ever add
      // latency to.
      // A machine (voicemail/fax) answer or no patient speech means no
      // conversation happened, so there's nothing for the summary to judge.
      const machineAnswered = !!answeredBy && (answeredBy === "fax" || answeredBy.startsWith("machine_"));
      const summarise =
        connected && updatedCall?.sessionId && updatedCall?.patientId && !(followUpTaskId && (patientSpoke === false || machineAnswered));
      if (summarise) {
        const settleFollowUp = (outcome: { followUpOutcome?: "resolved" | "needs_retry" | "needs_review"; doNotContactRequested?: boolean }) =>
          followUpTaskId
            ? handleFollowUpCallOutcome({
                taskId: followUpTaskId,
                twilioStatus: callStatus as TwilioCallStatus,
                patientSpoke,
                answeredBy,
                endedAt,
                ...identity,
                ...outcome,
              })
            : Promise.resolve();

        generateCallSummary(updatedCall.sessionId, updatedCall.clientId)
          .then(async (summary) => {
            if (!summary) {
              // No transcript / summary failed: the outcome is unclear. The
              // scheduler retries while attempts remain (never counting this
              // as a success, never leaving the day stuck).
              await settleFollowUp({});
              return;
            }
            await supabase.from("call_logs").update({ summary }).eq("id", callSid);
            if (summary.requestedDoNotContact && updatedCall.patientId) {
              await applyDoNotContactRequest(
                updatedCall.clientId,
                updatedCall.patientId,
                "Patient asked to stop being called (detected from call transcript).",
              );
            }
            await settleFollowUp({ followUpOutcome: summary.followUpOutcome, doNotContactRequested: summary.requestedDoNotContact });
          })
          .catch(async (err) => {
            console.error(`[Telephony/Status] Call summary failed for ${callSid}:`, err);
            await settleFollowUp({}).catch((e) =>
              console.error(`[Telephony/Status] Follow-up outcome handling failed for ${callSid}:`, e),
            );
          });
      } else if (followUpTaskId) {
        // Never connected (busy/no-answer/failed/canceled), or connected
        // without the patient ever speaking: known straight away from the
        // call itself, no summary needed — so a retry is scheduled at once.
        handleFollowUpCallOutcome({
          taskId: followUpTaskId,
          twilioStatus: callStatus as TwilioCallStatus,
          patientSpoke,
          answeredBy,
          endedAt,
          ...identity,
        }).catch((err) => console.error(`[Telephony/Status] Follow-up outcome handling failed for ${callSid}:`, err));
      }
    }

    // If this call was placed by a campaign, roll its outcome up into
    // campaign_calls and the parent campaign's running totals — this is
    // the only place a campaign call's terminal status is ever learned,
    // since placing the call only confirms Twilio accepted the request,
    // not that anyone answered. Read-then-write on the campaign counters
    // is not atomic — under Twilio callbacks landing at nearly the same
    // instant a count could theoretically under-count by one; the per-call
    // campaign_calls row itself (what the UI actually lists) is always
    // correct regardless.
    const campaignCallId = req.nextUrl.searchParams.get("campaignCallId");
    if (campaignCallId) {
      const callOutcome = statusMap[callStatus] || "completed";
      const { data: ccRow } = await supabase
        .from("campaign_calls")
        .update({ status: callOutcome, completedAt: Date.now() })
        .eq("id", campaignCallId)
        .select("campaignId")
        .single();

      if (ccRow?.campaignId) {
        const { data: campaign } = await supabase
          .from("call_campaigns")
          .select("completedCount, failedCount, totalRecipients")
          .eq("id", ccRow.campaignId)
          .single();

        if (campaign) {
          const countField = callOutcome === "failed" ? "failedCount" : "completedCount";
          const newCount = (campaign[countField] ?? 0) + 1;
          const completed = countField === "completedCount" ? newCount : campaign.completedCount ?? 0;
          const failed = countField === "failedCount" ? newCount : campaign.failedCount ?? 0;
          const isDone = completed + failed >= campaign.totalRecipients;

          await supabase
            .from("call_campaigns")
            .update({
              [countField]: newCount,
              ...(isDone && { status: "completed", completedAt: Date.now() }),
            })
            .eq("id", ccRow.campaignId);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Telephony/Status] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
