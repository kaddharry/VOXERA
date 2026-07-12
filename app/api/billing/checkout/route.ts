import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/db/server";
import { createCheckoutSession, SubscriptionTier } from "@/lib/billing/stripe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const supabaseServer = await createClient();
    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser();

    if (!user || authErr) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { tier, tenantId } = body;

    if (!tier || !tenantId) {
      return NextResponse.json({ error: "Missing tier or tenantId" }, { status: 400 });
    }

    // Verify the user actually owns this tenant
    const { data: tenant, error: tenantErr } = await supabaseServer
      .from("tenants")
      .select("id")
      .eq("id", tenantId)
      .eq("auth_user_id", user.id)
      .single();

    if (tenantErr || !tenant) {
      return NextResponse.json({ error: "Unauthorized access to tenant" }, { status: 403 });
    }

    const origin = req.headers.get("origin") || "http://localhost:3000";
    const url = await createCheckoutSession(tenantId, tier as SubscriptionTier, origin);

    return NextResponse.json({ url });
  } catch (err: any) {
    console.error("[Checkout API Error]", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
