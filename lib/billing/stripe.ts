import Stripe from "stripe";
import { supabase } from "../db/supabase";
import { nanoid } from "nanoid";

// Safely initialize stripe only if the key exists
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-06-24.dahlia",
      appInfo: {
        name: "VOXERA",
        version: "1.0.0",
      },
    })
  : null;

export type SubscriptionTier = "starter" | "growth" | "enterprise" | "free";

export interface TierLimits {
  calls: number;
  documents: number;
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: { calls: 10, documents: 1 },
  starter: { calls: 500, documents: 5 },
  growth: { calls: 2000, documents: 25 },
  enterprise: { calls: 999999, documents: 999999 },
};

// Maps tier names to Stripe Price IDs
const PRICE_IDS: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER || "price_dummy_starter",
  growth: process.env.STRIPE_PRICE_GROWTH || "price_dummy_growth",
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || "price_dummy_enterprise",
};

export async function createCheckoutSession(tenantId: string, tier: SubscriptionTier, origin: string) {
  if (!stripe) {
    console.warn("[Stripe] Stripe is not configured. Mocking checkout success.");
    return `${origin}/admin/settings?checkout=mock_success`;
  }

  const priceId = PRICE_IDS[tier];
  if (!priceId) {
    throw new Error(`Invalid tier: ${tier}`);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `${origin}/admin/settings?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/onboarding?step=2`,
    client_reference_id: tenantId, // Pass the tenantId to the webhook
    metadata: {
      tenantId,
      tier,
    },
  });

  return session.url;
}

export async function getSubscription(tenantId: string): Promise<{ tier: SubscriptionTier; status: string }> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("tier, status")
    .eq("tenant_id", tenantId)
    .single();

  if (error || !data) {
    return { tier: "free", status: "inactive" };
  }

  return {
    tier: data.tier as SubscriptionTier,
    status: data.status,
  };
}

export async function enforceLimit(tenantId: string, resource: "calls" | "documents"): Promise<boolean> {
  const sub = await getSubscription(tenantId);
  const limits = TIER_LIMITS[sub.tier];

  if (sub.status !== "active" && sub.tier !== "free") {
    return false; // Past due or cancelled
  }

  if (resource === "calls") {
    // Check call count this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count } = await supabase
      .from("call_logs")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("started_at", startOfMonth.toISOString());

    return (count || 0) < limits.calls;
  }

  if (resource === "documents") {
    // Check total document count
    const { count } = await supabase
      .from("knowledge_documents")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    return (count || 0) < limits.documents;
  }

  return false;
}
