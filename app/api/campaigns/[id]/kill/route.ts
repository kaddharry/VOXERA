import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/db/server";
import { getTwilioClient } from "../../../../../lib/telephony/twilio";

export const dynamic = "force-dynamic";

/**
 * POST /api/campaigns/[id]/kill — "Kill Call" on the Bulk Calls page.
 * Two things happen: (1) marks the campaign "cancelled" so
 * lib/telephony/campaign-dispatcher.ts's worker loop stops dialing any
 * further pending recipients (it re-checks this status before every dial),
 * and (2) hangs up any calls already in progress right now via Twilio's
 * REST API (updating a live call's status to "completed" ends it
 * immediately, same mechanism Twilio's own console "End Call" uses).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: campaign, error: campaignError } = await supabase
    .from("call_campaigns")
    .select("id, clientId")
    .eq("id", id)
    .eq("clientId", user.id)
    .single();
  if (campaignError || !campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  await supabase.from("call_campaigns").update({ status: "cancelled", completedAt: Date.now() }).eq("id", id);

  const { data: liveCalls } = await supabase
    .from("campaign_calls")
    .select("id, callSid")
    .eq("campaignId", id)
    .in("status", ["calling", "active"])
    .not("callSid", "is", null);

  let hungUp = 0;
  if (liveCalls && liveCalls.length > 0) {
    const client = getTwilioClient();
    for (const row of liveCalls) {
      try {
        await client.calls(row.callSid as string).update({ status: "completed" });
        hungUp++;
      } catch (err) {
        console.warn(`[Campaign ${id}] Failed to hang up call ${row.callSid}:`, err);
      }
      await supabase
        .from("campaign_calls")
        .update({ status: "cancelled", completedAt: Date.now() })
        .eq("id", row.id);
    }
  }

  // Any recipients that were still "pending" (never dialed) also get
  // marked so the progress table reads correctly instead of showing them
  // stuck at "pending" forever.
  await supabase
    .from("campaign_calls")
    .update({ status: "cancelled", completedAt: Date.now() })
    .eq("campaignId", id)
    .eq("status", "pending");

  return NextResponse.json({ success: true, hungUp });
}
