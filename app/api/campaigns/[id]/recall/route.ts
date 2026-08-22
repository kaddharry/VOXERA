import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../../lib/db/server";
import { dispatchCampaign } from "../../../../../lib/telephony/campaign-dispatcher";
import { isLocalBaseUrl, resolveBaseUrl } from "../../../../../lib/telephony/outbound";

export const dynamic = "force-dynamic";

/**
 * POST /api/campaigns/[id]/recall — "clear history and call the same
 * group again, picking the agent first". Reuses the existing campaign's
 * recipient list (deduped phone numbers from its current campaign_calls
 * rows), clears the old call history, resets counters, applies the newly
 * chosen agentId, and redispatches — same underlying dispatchCampaign()
 * the original "New Campaign" flow uses, just against a fresh set of
 * campaign_calls rows for the same recipients instead of a brand new
 * campaign record.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const agentId = body.agentId ? String(body.agentId) : undefined;

  const { data: campaign, error: campaignError } = await supabase
    .from("call_campaigns")
    .select("id, clientId")
    .eq("id", id)
    .eq("clientId", user.id)
    .single();
  if (campaignError || !campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const { data: existingCalls } = await supabase
    .from("campaign_calls")
    .select("phoneNumber")
    .eq("campaignId", id);
  const recipients = Array.from(new Set((existingCalls ?? []).map((c) => c.phoneNumber)));
  if (recipients.length === 0) {
    return NextResponse.json({ error: "This campaign has no recipients to re-call." }, { status: 400 });
  }

  const baseUrl = resolveBaseUrl(req);
  if (isLocalBaseUrl(baseUrl)) {
    return NextResponse.json(
      { error: "Outbound calls need a public URL Twilio can reach. Set NEXT_PUBLIC_BASE_URL (ngrok in local dev, your real domain in production)." },
      { status: 400 }
    );
  }

  // Clear history — same campaign row, fresh call_calls rows.
  await supabase.from("campaign_calls").delete().eq("campaignId", id);
  await supabase
    .from("call_campaigns")
    .update({
      agentId: agentId ?? null,
      status: "pending",
      completedCount: 0,
      failedCount: 0,
      totalRecipients: recipients.length,
      completedAt: null,
    })
    .eq("id", id);

  const { error: insertError } = await supabase
    .from("campaign_calls")
    .insert(recipients.map((phoneNumber) => ({ campaignId: id, phoneNumber, status: "pending" })));
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  void dispatchCampaign({ campaignId: id, clientId: user.id, agentId, baseUrl }).catch((err) =>
    console.error(`[Campaign ${id}] Re-dispatch failed:`, err)
  );

  return NextResponse.json({ success: true, recipients: recipients.length });
}
