import { seedClientMemory } from "./memory/writer";
import { vectorStore } from "./memory/store";
import { probeHealth } from "./db/supabase";

let seeded = false;

// Queued callers are dispatched by Twilio's queue waitUrl polls
// (app/api/telephony/queue-wait) against Postgres; no listener lives here.

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
