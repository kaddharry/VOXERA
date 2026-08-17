import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../lib/db/server";
import { dispatchCampaign } from "../../../lib/telephony/campaign-dispatcher";
import { isLocalBaseUrl, resolveBaseUrl } from "../../../lib/telephony/outbound";

export const dynamic = "force-dynamic";

const PHONE_RE = /^\+?[1-9]\d{7,14}$/;
const MAX_RECIPIENTS = 200;

/**
 * GET /api/campaigns
 *
 * Lists this tenant's bulk-calling campaigns, most recent first.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("call_campaigns")
    .select("*")
    .eq("clientId", user.id)
    .order("createdAt", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaigns: data ?? [] });
}

/**
 * POST /api/campaigns
 *
 * Creates a campaign and kicks off dialing every recipient in the
 * background. Body: { name: string, agentId?: string, recipients: string[] }
 * Returns the created campaign immediately — the dispatcher continues
 * running after the response is sent (see lib/telephony/campaign-dispatcher.ts).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const agentId = body.agentId ? String(body.agentId) : undefined;
  const rawRecipients: string[] = Array.isArray(body.recipients) ? body.recipients : [];

  if (!name) {
    return NextResponse.json({ error: "Campaign name is required." }, { status: 400 });
  }

  const recipients = Array.from(new Set(rawRecipients.map((r) => String(r).trim()).filter(Boolean)));
  const invalid = recipients.filter((r) => !PHONE_RE.test(r));

  if (recipients.length === 0) {
    return NextResponse.json({ error: "Add at least one recipient phone number." }, { status: 400 });
  }
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Invalid phone number(s): ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? "…" : ""}` }, { status: 400 });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json({ error: `A campaign can have at most ${MAX_RECIPIENTS} recipients.` }, { status: 400 });
  }

  const baseUrl = resolveBaseUrl(req);
  if (isLocalBaseUrl(baseUrl)) {
    return NextResponse.json(
      { error: "Outbound calls need a public URL Twilio can reach. Set NEXT_PUBLIC_BASE_URL (ngrok in local dev, your real domain in production)." },
      { status: 400 }
    );
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("call_campaigns")
    .insert([{ clientId: user.id, agentId, name, status: "pending", totalRecipients: recipients.length }])
    .select("*")
    .single();

  if (campaignError || !campaign) {
    return NextResponse.json({ error: campaignError?.message || "Failed to create campaign" }, { status: 500 });
  }

  const { error: callsError } = await supabase
    .from("campaign_calls")
    .insert(recipients.map((phoneNumber) => ({ campaignId: campaign.id, phoneNumber, status: "pending" })));

  if (callsError) {
    return NextResponse.json({ error: callsError.message }, { status: 500 });
  }

  // Fire-and-forget: this Node process (custom-server.ts) stays alive after
  // the response is sent, so the dispatcher keeps dialing in the background.
  void dispatchCampaign({ campaignId: campaign.id, clientId: user.id, agentId, baseUrl }).catch((err) =>
    console.error(`[Campaign ${campaign.id}] Dispatch failed:`, err)
  );

  return NextResponse.json({ campaign });
}
