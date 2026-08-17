import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../../lib/db/supabase";

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

    const { error } = await supabase
      .from("call_logs")
      .update(updates)
      .eq("id", callSid);

    if (error) {
      console.error("[Telephony/Status] DB update failed:", error);
      return NextResponse.json({ error: "DB update failed" }, { status: 500 });
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
