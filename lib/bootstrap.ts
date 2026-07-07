import { seedClientMemory } from "./memory/writer";
import { vectorStore } from "./memory/store";
import { probeHealth } from "./db/supabase";
import { callQueue } from "./queue/manager";
import { getTwilioClient } from "./telephony/twilio";

let seeded = false;

// Register the slot open callback to dynamically redirect callers out of Twilio Enqueue
callQueue.onSlotOpen(async () => {
  while (callQueue.getQueueLength() > 0 && callQueue.canAcceptCall()) {
    const nextCaller = callQueue.peekNextCaller();
    if (!nextCaller) break;

    try {
      const client = getTwilioClient();
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
      // Redirect URL that will return buildConnectTwiml()
      const redirectUrl = `${baseUrl}/api/telephony/dequeue?callSid=${nextCaller.id}&clientId=${nextCaller.clientId || "demo"}&caller=${encodeURIComponent(nextCaller.phoneNumber || "unknown")}`;

      console.log(`[Telephony Queue] Auto-redirecting queued caller ${nextCaller.id} out of Enqueue...`);
      
      // Dequeue first to prevent duplicate processing
      callQueue.dequeueCaller(nextCaller.id);

      await client.calls(nextCaller.id).update({
        url: redirectUrl,
        method: "POST",
      });

      // Slot filled, continue to next if we still have capacity
    } catch (err: any) {
      console.error(`[Telephony Queue] Failed to redirect queued caller ${nextCaller.id}:`, err?.message ?? err);
      // Remove failed caller from queue to avoid blockages
      callQueue.dequeueCaller(nextCaller.id);
    }
  }
});

export const DEMO = {
  clientId: "acme-telecom",
  userId: "user_42",
  sessionId: "session_local",
};

export async function ensureSeeded() {
  if (seeded) return;

  const healthy = await probeHealth();
  if (!healthy) {
    console.warn("[Bootstrap] Supabase unreachable — skipping seed, circuit breaker open.");
    seeded = true;
    return;
  }

  const ltmCands = await vectorStore.byTier("LTM_client", null, DEMO.clientId);
  if (ltmCands.length > 0) {
    seeded = true;
    return;
  }
  await seedClientMemory({
    clientId: DEMO.clientId,
    topic: "brand_voice",
    text: "Brand voice: warm, direct, never defensive. Prefer short sentences. Apologize sincerely when the user is frustrated. Offer concrete next steps.",
  });
  await seedClientMemory({
    clientId: DEMO.clientId,
    topic: "compliance",
    text: "Compliance: never disclose account balances without explicit identity confirmation. For distress signals, follow safety-first protocol.",
  });
  await seedClientMemory({
    clientId: DEMO.clientId,
    topic: "escalation",
    text: "Escalation matrix: repeated signal complaint with negative valence → route to Tier-2 within 60 seconds. Chronic issues → offer service credit.",
  });
  seeded = true;
}
