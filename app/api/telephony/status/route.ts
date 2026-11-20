import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { supabase } from "../../../../lib/db/supabase";
import { enqueueJob, runJobNow } from "../../../../lib/jobs/background-jobs";
import { POST_CALL_JOB, postCallJobKey, runPostCallJob, type PostCallPayload } from "../../../../lib/telephony/post-call";
import { finishQueuedCall, releaseCallSlot } from "../../../../lib/telephony/call-coordination";
import { verifyTwilioWebhook } from "../../../../lib/telephony/webhook-auth";

export const dynamic = "force-dynamic";
// The after-call job below runs after Twilio gets its reply, so give it the
// most time the free Vercel plan allows. If it still doesn't finish, the job
// stays in Postgres and the cron retries it.
export const maxDuration = 300;

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
    if (!verifyTwilioWebhook(req, params).ok) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const callSid = params.CallSid;
    const callStatus = params.CallStatus; // completed | busy | no-answer | failed | canceled
    const callDuration = params.CallDuration; // seconds (Twilio provides this on completion)

    console.log(`[Telephony/Status] CallSid=${callSid}, status=${callStatus}, duration=${callDuration}s`);

    if (!callSid) {
      return NextResponse.json({ error: "Missing CallSid" }, { status: 400 });
    }

    const statusMap: Record<string, "completed" | "failed"> = {
      completed: "completed",
      busy: "failed",
      "no-answer": "failed",
      failed: "failed",
      canceled: "failed",
    };

    // Only the final status means the call is over. VOXERA only subscribes to
    // "completed" (lib/telephony/twilio.ts), but a status callback set on the
    // phone number in the Twilio console may also send ringing/in-progress.
    if (!(callStatus in statusMap)) {
      return NextResponse.json({ ok: true, ignored: callStatus });
    }

    // The call is over: free its slot (idempotent; the WebSocket close may
    // already have) and close any queue entry it still had (a caller who
    // hung up while waiting).
    await releaseCallSlot(callSid, `twilio_status:${callStatus}`);
    await finishQueuedCall(callSid, "abandoned", `call ${callStatus} while queued`);

    // When the call ended: Twilio sends this callback the moment it does.
    // Follow-up retries are timed from here, not from whenever the
    // post-call summary finishes.
    const endedAt = Date.now();
    const outcome = statusMap[callStatus] || "completed";
    const updates: Record<string, unknown> = { status: outcome, endedAt };
    if (callDuration) {
      updates.durationMs = parseInt(callDuration, 10) * 1000;
    }

    const { data: updatedCall, error } = await supabase
      .from("call_logs")
      .update(updates)
      .eq("id", callSid)
      .select('sessionId, "followUpTaskId"')
      .maybeSingle();
    if (error) console.error("[Telephony/Status] DB update failed:", error);

    // Scheduled follow-up calls carry their task id on this callback's URL
    // (lib/telephony/outbound.ts), so the outcome still reaches the task when
    // there's no call_logs row yet (a call that failed within milliseconds).
    const followUpTaskId = (updatedCall?.followUpTaskId as string | null) ?? req.nextUrl.searchParams.get("followUpTaskId");
    // Which attempt this call was, so a late callback from an earlier
    // attempt can't be applied to a newer one.
    const attemptParam = Number(req.nextUrl.searchParams.get("followUpAttempt"));

    if (error && !followUpTaskId && !req.nextUrl.searchParams.get("campaignCallId")) {
      return NextResponse.json({ error: "DB update failed" }, { status: 500 });
    }

    // Summary, follow-up decision, appointment outcome and self-learning
    // findings: saved as a durable job first, then run right away. If this
    // run is cut short, the cron (/api/cron/dispatch) retries it.
    if (updatedCall || followUpTaskId) {
      const payload: PostCallPayload = {
        callSid,
        callStatus,
        outcome,
        endedAt,
        followUpTaskId: followUpTaskId ?? null,
        ...(Number.isInteger(attemptParam) && attemptParam > 0 && { attempt: attemptParam }),
        answeredBy: params.AnsweredBy || null,
      };
      const job = await enqueueJob(POST_CALL_JOB, postCallJobKey(callSid), payload as unknown as Record<string, unknown>);
      if (job) {
        waitUntil(runJobNow(postCallJobKey(callSid), runPostCallJob));
      } else {
        // The jobs table isn't reachable (e.g. migration_v33 not applied
        // yet): still do the work now, without the retry safety net.
        waitUntil(
          runPostCallJob({ id: "inline", kind: POST_CALL_JOB, idempotency_key: postCallJobKey(callSid), payload: payload as unknown as Record<string, unknown>, status: "running", attempts: 1, max_attempts: 1, last_error: null })
            .catch((err) => console.error(`[Telephony/Status] Post-call work failed for ${callSid}:`, err)),
        );
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
