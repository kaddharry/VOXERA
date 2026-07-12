import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/billing/stripe";
import { supabase } from "@/lib/db/supabase";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }

  const payload = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error(`Webhook signature verification failed:`, err.message);
    return NextResponse.json({ error: "Webhook Error" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        const tenantId = session.client_reference_id;
        const tier = session.metadata?.tier;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        if (tenantId && tier) {
          // Upsert subscription
          const { error } = await supabase.from("subscriptions").upsert({
            id: nanoid(),
            tenant_id: tenantId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            tier,
            status: "active",
          }, { onConflict: "tenant_id" });

          if (error) {
            console.error("Failed to insert subscription", error);
          }
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as any;
        await supabase
          .from("subscriptions")
          .update({
            status: sub.status,
            current_period_end: sub.current_period_end,
          })
          .eq("stripe_subscription_id", sub.id);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as any;
        await supabase
          .from("subscriptions")
          .update({
            status: "canceled",
            current_period_end: sub.current_period_end,
          })
          .eq("stripe_subscription_id", sub.id);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
