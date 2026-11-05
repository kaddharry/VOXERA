/**
 * Runs scripted, multi-turn simulated phone calls through the REAL emotion
 * pipeline (detectTextEmotion → fuseEmotion → buildEmotionContext →
 * resolvePersonaLock → getEmotionPersona) turn by turn, exactly the way
 * lib/agent/orchestrator.ts does for a live call — no mocks, no DB. Prints a
 * per-turn report plus the whole-call summary, so the engine's real behavior
 * on a full conversation (not just isolated single-sentence checks) can be
 * read directly, and deliberately includes adversarial/edge-case turns to
 * try to break it the way a real call would.
 *
 *   npx tsx scripts/simulate-call-emotion.ts
 */
import { detectTextEmotion, fuseEmotion } from "../lib/emotion/detect";
import { buildEmotionContext } from "../lib/emotion/context";
import { resolvePersonaLock } from "../lib/emotion/persona-lock";
import { getEmotionPersona } from "../lib/emotion/persona";
import { summarizeCallEmotion, describeCallEmotion, type TurnEmotion } from "../lib/emotion/call-emotion";
import type { Utterance } from "../lib/types";

interface ScriptedCall {
  name: string;
  turns: string[];
}

async function simulateCall(call: ScriptedCall) {
  console.log(`\n${"=".repeat(78)}\nCALL: ${call.name}\n${"=".repeat(78)}`);
  const sessionId = `sim-${call.name.replace(/\s+/g, "_")}-${Date.now()}-${Math.random()}`;
  const stm: Utterance[] = [];
  const turnEmotions: TurnEmotion[] = [];

  for (let i = 0; i < call.turns.length; i++) {
    const text = call.turns[i];
    const t0 = Date.now();
    let line: string;
    try {
      const textResult = await detectTextEmotion(text);
      const fused = fuseEmotion(textResult.primary, null);
      const emotionCtx = buildEmotionContext({ current: fused, stm, ltmUser: [] });
      const lock = await resolvePersonaLock(sessionId, emotionCtx);
      const persona = getEmotionPersona(emotionCtx, lock.label);

      const flagsOn = Object.entries(emotionCtx.flags).filter(([, v]) => v).map(([k]) => k).join(",") || "-";
      line =
        `#${i + 1} "${text.length > 55 ? text.slice(0, 55) + "…" : text}"\n` +
        `    label=${fused.label.padEnd(14)} conf=${fused.confidence.toFixed(2)} v=${fused.vad.v.toFixed(2).padStart(5)} a=${fused.vad.a.toFixed(2).padStart(5)} mixed=${fused.isMixed ?? false}  engine=${textResult.selection.engine}\n` +
        `    flags=[${flagsOn}]  slope_v=${emotionCtx.trajectory.slope_v.toFixed(2)} slope_a=${emotionCtx.trajectory.slope_a.toFixed(2)} zDev=${emotionCtx.zDeviation.toFixed(2)}\n` +
        `    lock=${lock.label}${lock.justShifted ? "(SHIFTED)" : ""} streak=${lock.pendingStreak}  persona="${persona.tone.slice(0, 45)}…"`;

      stm.push({ id: `u${i}`, role: "user", text, emotion: fused, ts: Date.now() + i });
      turnEmotions.push({ label: fused.label, intensity: fused.intensity, vad: fused.vad });
    } catch (err) {
      line = `#${i + 1} "${text}"\n    *** THREW: ${err instanceof Error ? err.stack ?? err.message : String(err)} ***`;
    }
    const ms = Date.now() - t0;
    console.log(line + (ms > 50 ? `  [${ms}ms]` : ""));
  }

  const summary = summarizeCallEmotion(turnEmotions);
  console.log(`\n  SUMMARY: ${summary ? describeCallEmotion(summary) : "no data"}`);
}

// ─── Realistic multi-turn calls ─────────────────────────────────────────────

const CALLS: ScriptedCall[] = [
  {
    name: "A — Steadily declining post-op patient",
    turns: [
      "Hello?",
      "Yes, I'm okay I think.",
      "Well actually my side hurts a bit since this morning.",
      "I took the painkiller but it didn't really help much.",
      "Honestly it's gotten worse since yesterday.",
      "I'm a bit worried, is that normal?",
      "There's also some swelling around the area now.",
      "I feel really weak and I haven't been able to sleep.",
      "I don't know, I just feel very low about all this.",
      "Like, I can't do anything by myself right now.",
    ],
  },
  {
    name: "B — Recovering well, happy and grateful",
    turns: [
      "Hi there!",
      "I'm doing great actually, thank you for asking.",
      "The pain has pretty much gone away.",
      "Yeah I'm healing nicely, way better than I expected.",
      "Thank you so much for checking in, it means a lot.",
      "No complaints at all, everything feels back to normal.",
    ],
  },
  {
    name: "C — Confused and frustrated about medication/scheduling",
    turns: [
      "Hello, yes, I have a question.",
      "I don't understand which medicine to take when.",
      "I already asked this yesterday, this is the third time I'm asking.",
      "Nobody called me back after I left a message.",
      "This is honestly ridiculous, I've been on hold for ages.",
      "Can someone please just tell me the dosage clearly?",
      "Okay, thank you, that actually makes sense now.",
    ],
  },
  {
    name: "D — Mood swings / mixed and sarcastic signals",
    turns: [
      "Oh great, ANOTHER call about my surgery.",
      "No I'm kidding, I'm fine, really.",
      "Actually you know what, I got the internship I applied for!",
      "But then I found out my stitches got infected, so that's fun.",
      "I'm not sure how to feel about any of this honestly.",
      "Whatever, it is what it is I guess.",
      "Sorry, ignore that, I'm just tired.",
    ],
  },
  {
    name: "E — Safety-critical distress call",
    turns: [
      "Hi.",
      "I've been in a lot of pain since yesterday.",
      "Honestly I don't know how much more of this I can take.",
      "I feel like I'm falling apart.",
      "Sometimes I just think about ending it all.",
      "Sorry, I don't really mean that, I'm just overwhelmed.",
      "Can someone actually help me today?",
    ],
  },
  {
    name: "F — Short, clipped, low-information replies (common on real calls)",
    turns: ["Yeah.", "Okay.", "Mm.", "No.", "Fine.", "Sure.", "I guess.", "Whatever.", "K.", "Bye."],
  },
  {
    name: "G — Realistic STT noise and disfluency",
    turns: [
      "uh hello um yeah",
      "like its its kind of uh painful i guess",
      "no no i mean its its not that bad",
      "um so when when can i like take a bath",
      "sorry what did you say can you repeat that",
      "uh yeah no that that makes sense thanks",
    ],
  },
  {
    name: "H — Interrupted / half-finished sentences (barge-in artifacts)",
    turns: [
      "I'm really worried that something",
      "went wrong in the surgery",
      "because the doctor said",
      "it should've healed by now but it",
      "hasn't, and I don't know what to",
      "do about it honestly",
    ],
  },
];

// ─── Adversarial single-shot inputs (not a flowing call — stress the function directly) ──

const ADVERSARIAL_INPUTS: string[] = [
  "",
  "   ",
  "...",
  "??????",
  "!!!!!!!!!!!!!!!!",
  "a".repeat(5000),
  "I'm not not unhappy about this not being bad",
  "sick sick sick sick sick",
  "😭😭😭 I feel so sad 😭😭😭",
  "मुझे बहुत दर्द हो रहा है",
  "<script>alert(1)</script> I feel terrible",
  "I feel great but also terrible but also fine but also awful",
  "worse worse worse worse worse worse worse worse",
  "N/A",
  "123456789",
  "null",
  "undefined",
  "I feel " + "really ".repeat(200) + "sad",
];

async function runAdversarial() {
  console.log(`\n${"=".repeat(78)}\nADVERSARIAL SINGLE-SHOT INPUTS\n${"=".repeat(78)}`);
  for (const text of ADVERSARIAL_INPUTS) {
    const label = text.length > 60 ? `${text.slice(0, 60)}…(${text.length} chars)` : JSON.stringify(text);
    try {
      const t0 = Date.now();
      const textResult = await detectTextEmotion(text);
      const fused = fuseEmotion(textResult.primary, null);
      const ms = Date.now() - t0;
      const bad =
        !Number.isFinite(fused.confidence) || fused.confidence < 0 || fused.confidence > 1 ||
        !Number.isFinite(fused.vad.v) || Math.abs(fused.vad.v) > 1 ||
        !Number.isFinite(fused.intensity);
      console.log(`${bad ? "*** INVALID OUTPUT *** " : ""}${label} -> label=${fused.label} conf=${fused.confidence.toFixed(2)} v=${fused.vad.v.toFixed(2)}${ms > 100 ? `  [${ms}ms]` : ""}`);
    } catch (err) {
      console.log(`*** THREW *** ${label} -> ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    }
  }
}

async function main() {
  for (const call of CALLS) {
    await simulateCall(call);
  }
  await runAdversarial();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
