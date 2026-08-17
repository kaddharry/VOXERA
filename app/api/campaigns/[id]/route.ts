import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/db/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/campaigns/[id]
 *
 * Campaign detail: the campaign row plus every recipient's live call
 * status, for the running progress table.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("call_campaigns")
    .select("*")
    .eq("id", id)
    .eq("clientId", user.id)
    .single();

  if (campaignError || !campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const { data: calls, error: callsError } = await supabase
    .from("campaign_calls")
    .select("*")
    .eq("campaignId", id)
    .order("createdAt", { ascending: true });

  if (callsError) {
    return NextResponse.json({ error: callsError.message }, { status: 500 });
  }

  return NextResponse.json({ campaign, calls: calls ?? [] });
}
