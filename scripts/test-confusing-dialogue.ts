import { handleTurn } from "../lib/agent/orchestrator";
import { DEMO, ensureSeeded } from "../lib/bootstrap";

const TEST_DIALOGUE = [
  "Hi, I just got an email saying I got an internship! I'm completely blown away.",
  "Yeah, well I kept reading and found out it's completely unpaid... so I'm basically working for free.",
  "But I mean, they did say there is a strong possibility it converts to a full-time employment later.",
  "I don't know, my parents are furious that I'm taking a job without pay.",
  "I guess it's a huge relief to finally have something on my resume though!!!",
  "Wait, I just saw they want me to relocate to another state. That's a disaster.",
  "Actually, they're providing a housing stipend! Oh my god, yes yes yes!",
  "But the stipend is only for the first month... what kind of joke is this?",
  "You know what, whatever. I'm going to take it and prove them wrong.",
  "Thank you for listening. This whole thing has been a rollercoaster and I'm just so tired."
];

function formatTrace(trace: any, text: string) {
  const t = trace;
  const e = t.emotion.current;
  const c = e.confidenceCategory;
  
  // Create a mock CAI score for the UI output parity, since CAI is generated on the client side in this app version
  let caiScore = 50 + Math.floor(e.vad.a * 30);
  let caiText = "Moderate Engagement";
  if (e.intensity > 0.7) { caiScore += 20; caiText = "High Engagement"; }
  if (e.intensity < 0.3) { caiScore -= 20; caiText = "Low Engagement"; }
  
  const flags = Object.keys(t.emotion.flags).filter((k) => t.emotion.flags[k]).join(", ");
  
  console.log(`\n======================================================`);
  console.log(`🗣️ USER: "${text}"`);
  console.log(`🤖 AGENT: "${t.reply}"`);
  console.log(`------------------------------------------------------`);
  console.log(`Acoustic Trace & Policy`);
  console.log(`Emotion`);
  console.log(`${e.label} · ${e.intensity.toFixed(2)}`);
  console.log(`Confidence`);
  console.log(`${e.confidence.toFixed(2)} (${c?.level || "unknown"})`);
  console.log(`Importance`);
  console.log(`${t.importance.toFixed(2)}`);
  console.log(`Memory`);
  console.log(`${t.memoryWrite.tier}`);
  console.log(`VAD`);
  console.log(`${e.vad.v.toFixed(2)} / ${e.vad.a.toFixed(2)} / ${e.vad.d.toFixed(2)}`);
  console.log(`Trajectory`);
  console.log(`Δv=${t.emotion.trajectory.slope_v.toFixed(2)} Δa=${t.emotion.trajectory.slope_a.toFixed(2)}`);
  console.log(`Policy`);
  console.log(`${t.policy.pace} · esc=${t.policy.escalate}`);
  console.log(`Flags`);
  console.log(`${flags || "—"}`);
  console.log(`CAI ${caiScore}`);
  console.log(`${caiText}: Score affected by textual VAD arousal mappings.`);
  console.log(`======================================================\n`);
}

async function run() {
  console.log("Seeding bootstrap data...");
  await ensureSeeded();
  
  const sessionId = "confusing-dialogue-" + Date.now();
  
  for (let i = 0; i < TEST_DIALOGUE.length; i++) {
    const text = TEST_DIALOGUE[i];
    
    // Process turn
    const out = await handleTurn({
      sessionId,
      userId: DEMO.userId,
      clientId: DEMO.clientId,
      transcript: text
    });
    
    // The handleTurn returns { reply, trace }. We want to format trace and inject reply.
    const combinedTrace = {
      ...out.trace,
      reply: out.reply
    };
    
    formatTrace(combinedTrace, text);
  }
}

run().catch(console.error);
