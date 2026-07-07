import { config } from "dotenv";
config({ path: ".env.local" });

import { handleTurn } from "./lib/agent/orchestrator";
import { DEMO, ensureSeeded } from "./lib/bootstrap";

async function run() {
  await ensureSeeded();
  
  const text = "i am feeling low because i got an internship";
  
  const out = await handleTurn({
    sessionId: "test-mixed-" + Date.now(),
    userId: DEMO.userId,
    clientId: DEMO.clientId,
    transcript: text
  });
  
  console.log(`\n🗣️ USER: "${text}"`);
  console.log(`🤖 AGENT: "${out.reply}"`);
  console.log(`Emotion Label: ${out.trace.emotion.current.label}`);
  console.log(`isMixed: ${out.trace.emotion.current.isMixed}`);
}

run().catch(console.error);
