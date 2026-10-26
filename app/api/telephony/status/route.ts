import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../lib/db/supabase";
import { generateCallSummary } from "../../../../lib/agent/call-summary";
import { handleFollowUpCallOutcome, applyDoNotContactRequest } from "../../../../lib/scheduler/dispatcher";
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

    const updates: Record<string, unknown> = {
      status: statusMap[callStatus] || "completed",
      endedAt: Date.now(),
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

    if (error || !updatedCall) {
      if (error) console.error("[Telephony/Status] DB update failed:", error);
      if (followUpTaskId) {
        await handleFollowUpCallOutcome({ taskId: followUpTaskId, twilioStatus: callStatus as TwilioCallStatus }).catch((err) =>
          console.error(`[Telephony/Status] Follow-up outcome handling failed for ${callSid}:`, err),
        );
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

      // Post-call LLM-judge summary for the doctor to review — only for calls
      // that actually completed with a real transcript (not busy/no-answer/
      // failed), and only ones placed against a roster patient. Fire-and-
      // forget: this webhook's job is confirming Twilio's status update was
      // recorded, not waiting on an LLM call — and the call has already
      // ended by this point, so there's no live turn this could ever add
      // latency to.
      if (updates.status === "completed" && updatedCall?.sessionId && updatedCall?.patientId) {
        generateCallSummary(updatedCall.sessionId, updatedCall.clientId)
          .then(async (summary) => {
            if (!summary) {
              // No transcript / summary failed — the scheduler still needs a
              // decision, so it falls through to the conservative
              // "needs_review" default rather than silently never resolving
              // this follow-up task at all.
              if (followUpTaskId) {
                await handleFollowUpCallOutcome({
                  taskId: followUpTaskId,
                  twilioStatus: callStatus as TwilioCallStatus,
                });
              }
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
            if (followUpTaskId) {
              await handleFollowUpCallOutcome({
                taskId: followUpTaskId,
                twilioStatus: callStatus as TwilioCallStatus,
                followUpOutcome: summary.followUpOutcome,
              });
            }
          })
          .catch(async (err) => {
            console.error(`[Telephony/Status] Call summary failed for ${callSid}:`, err);
            // The follow-up still needs a decision when the summary step
            // throws (LLM down, bad response). With no outcome it falls to
            // the conservative "needs_review" instead of staying "calling".
            if (followUpTaskId) {
              await handleFollowUpCallOutcome({ taskId: followUpTaskId, twilioStatus: callStatus as TwilioCallStatus }).catch((e) =>
                console.error(`[Telephony/Status] Follow-up outcome handling failed for ${callSid}:`, e),
              );
            }
          });
      } else if (followUpTaskId) {
        // Never connected (busy/no-answer/failed/canceled) — retryability is
        // known immediately from the Twilio status alone, no summary needed.
        handleFollowUpCallOutcome({
          taskId: followUpTaskId,
          twilioStatus: callStatus as TwilioCallStatus,
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
