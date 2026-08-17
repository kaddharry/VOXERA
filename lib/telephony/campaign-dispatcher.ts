import { supabase } from "../db/supabase";
import { placeOutboundCall } from "./outbound";

// Twilio trial accounts and most production numbers throttle concurrent
// call-creation API calls; a small cap plus a short gap between dispatches
// keeps a campaign from hammering the Twilio API in a tight loop, which
// would just produce a wall of 429s instead of calls.
const CONCURRENCY = 2;
const DISPATCH_GAP_MS = 400;

/**
 * Dials every pending recipient in a campaign, respecting a small
 * concurrency cap. Runs detached from the request that created the
 * campaign — this process (custom-server.ts) is a long-running Node
 * server, not a serverless function, so a fire-and-forget async function
 * keeps executing after the POST /api/campaigns response has already been
 * sent; that's what lets campaign creation return immediately instead of
 * blocking on every recipient being dialed one at a time.
 *
 * Placing a call only confirms Twilio *accepted* the request — it does not
 * mean anyone answered. A call's real outcome (answered/busy/no-answer/
 * failed) is learned later via the Twilio status callback wired in
 * placeOutboundCall, handled by app/api/telephony/status/route.ts. This
 * function only marks a row "failed" itself when Twilio rejects the
 * request outright (bad number, account restriction, etc.) — a case the
 * status callback will never fire for, since no call was ever created.
 */
export async function dispatchCampaign(opts: {
  campaignId: string;
  clientId: string;
  agentId?: string;
  baseUrl: string;
}): Promise<void> {
  const { data: pending, error } = await supabase
    .from("campaign_calls")
    .select("id, phoneNumber")
    .eq("campaignId", opts.campaignId)
    .eq("status", "pending");

  if (error || !pending || pending.length === 0) return;
  const jobs = pending;

  await supabase.from("call_campaigns").update({ status: "running" }).eq("id", opts.campaignId);

  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const row = jobs[cursor];
      cursor += 1;

      try {
        await supabase.from("campaign_calls").update({ status: "calling" }).eq("id", row.id);

        const { callSid } = await placeOutboundCall({
          to: row.phoneNumber,
          clientId: opts.clientId,
          agentId: opts.agentId,
          baseUrl: opts.baseUrl,
          campaignCallId: row.id,
        });

        await supabase.from("campaign_calls").update({ callSid }).eq("id", row.id);
      } catch (err: any) {
        console.error(`[Campaign] Failed to dial ${row.phoneNumber} for campaign ${opts.campaignId}:`, err);
        await supabase
          .from("campaign_calls")
          .update({ status: "failed", error: err.message || "Failed to place call", completedAt: Date.now() })
          .eq("id", row.id);

        const { data: campaign } = await supabase
          .from("call_campaigns")
          .select("failedCount, completedCount, totalRecipients")
          .eq("id", opts.campaignId)
          .single();
        if (campaign) {
          const failedCount = (campaign.failedCount ?? 0) + 1;
          const isDone = failedCount + (campaign.completedCount ?? 0) >= campaign.totalRecipients;
          await supabase
            .from("call_campaigns")
            .update({ failedCount, ...(isDone && { status: "completed", completedAt: Date.now() }) })
            .eq("id", opts.campaignId);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, DISPATCH_GAP_MS));
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()));
}
