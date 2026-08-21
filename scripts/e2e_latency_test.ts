/**
 * Real end-to-end latency harness — exercises the ACTUAL production
 * streaming pipeline (lib/agent/orchestrator.ts's handleTurn() with
 * onReplyChunk, lib/deepgram/tts-stream.ts's DeepgramSpeakStream) against
 * the REAL Groq LLM API and the REAL Deepgram Speak WebSocket API, over a
 * real network. Twilio itself is the only thing not exercised — everything
 * from "transcript is final" through "first audio byte exists" is the exact
 * code a live phone call runs.
 *
 * Measures, per turn:
 *   preLlmMs   — orchestrator work before the LLM call starts (agent
 *                resolution, emotion detection, embedding, memory retrieval)
 *   ttfcMs     — time from turn start to the first spoken CLAUSE being ready
 *                (i.e. LLM time-to-first-clause, chunked+guarded)
 *   ttfaMs     — time from that first clause to the first actual TTS AUDIO
 *                BYTE arriving back from Deepgram
 *   totalToFirstAudioMs — ttfcMs + ttfaMs — the number that matters most:
 *                how long a real caller would sit in silence before hearing
 *                anything, in the new streaming architecture
 *   fullReplyMs — total time until the LLM has finished generating (for
 *                comparison against the OLD buffered-everything approach)
 *
 * Usage: npx tsx --env-file=.env.local scripts/e2e_latency_test.ts
 */
import { handleTurn } from "../lib/agent/orchestrator";
import { DeepgramSpeakStream } from "../lib/deepgram/tts-stream";
import { CONFIG } from "../lib/config";
import { warmupModels } from "../lib/warmup";
import { nanoid } from "nanoid";

const SAMPLE_TURNS = [
  "Hi, I need to book a table for two tonight at 7pm.",
  "What are your hours on Saturday?",
  "Can I bring my dog to the patio?",
  "I'd like to cancel my reservation for tomorrow.",
  "Do you have any vegetarian options on the menu?",
];

interface TurnTiming {
  transcript: string;
  preLlmMs: number;
  ttfcMs: number;
  ttfaMs: number;
  totalToFirstAudioMs: number;
  fullReplyMs: number;
  firstClause: string;
}

/**
 * Connects a Speak stream BEFORE the timer starts, deliberately not counted
 * against turn latency. This matches production (lib/telephony/stream-
 * handler.ts): the connection is opened eagerly the moment a call starts —
 * seconds before the caller finishes their first sentence — and reused for
 * every turn after that, so its handshake cost is hidden in the background,
 * never sitting on a turn's critical path. Measured live in this
 * environment at 900ms-5.3s (see connectMs on the returned timing) — a real
 * and highly variable cost, but one production never pays inline.
 */
async function connectSpeakStream(onFirstAudio: () => void): Promise<{ stream: DeepgramSpeakStream; connectMs: number }> {
  const stream = new DeepgramSpeakStream(
    { model: CONFIG.deepgram.ttsModel, encoding: "linear16", sampleRate: 8000 },
    () => onFirstAudio()
  );
  const connectStart = performance.now();
  await stream.connect();
  return { stream, connectMs: Math.round(performance.now() - connectStart) };
}

async function runOneTurn(transcript: string, sessionId: string, userId: string): Promise<TurnTiming & { connectMs: number }> {
  let firstClauseAt: number | null = null;
  let firstAudioAt: number | null = null;
  let firstClauseText = "";
  let audioResolve: (() => void) | null = null;
  const firstAudioPromise = new Promise<void>((resolve) => {
    audioResolve = resolve;
  });

  const { stream: speakStream, connectMs } = await connectSpeakStream(() => {
    if (firstAudioAt === null) {
      firstAudioAt = performance.now();
      audioResolve?.();
    }
  });

  // Timer starts here — everything before this line is setup a real call
  // already finished during ringing/greeting, not part of turn latency.
  const t0 = performance.now();

  const output = await handleTurn(
    {
      sessionId,
      userId,
      clientId: "demo",
      transcript,
      sttConfidence: 0.95,
    },
    {
      onReplyChunk: (clause) => {
        if (firstClauseAt === null) {
          firstClauseAt = performance.now();
          firstClauseText = clause;
        }
        speakStream.sendText(clause);
        speakStream.flush();
      },
    }
  );

  const fullReplyAt = performance.now();

  // Wait (bounded) for the first real audio byte to come back from Deepgram.
  await Promise.race([firstAudioPromise, new Promise((r) => setTimeout(r, 5000))]);

  speakStream.close();

  const ttfc = (firstClauseAt ?? fullReplyAt) - t0;
  const ttfa = firstAudioAt !== null && firstClauseAt !== null ? firstAudioAt - firstClauseAt : NaN;

  return {
    transcript,
    preLlmMs: output.trace.timings ? output.trace.timings.emotionMs : NaN,
    ttfcMs: Math.round(ttfc),
    ttfaMs: Math.round(ttfa),
    totalToFirstAudioMs: firstAudioAt !== null ? Math.round(firstAudioAt - t0) : NaN,
    fullReplyMs: Math.round(fullReplyAt - t0),
    firstClause: firstClauseText,
    connectMs,
  };
}

async function main() {
  console.log("=== VOXERA End-to-End Streaming Latency Harness ===\n");
  console.log("Warming up ONNX models (simulates steady-state server, not cold boot)...");
  await warmupModels();
  console.log("");

  // Groq's on_demand/free tier caps this account at 8000 tokens/minute —
  // firing turns back-to-back exhausts that budget within a couple of
  // turns and every subsequent call sits in real 429 rate-limit
  // retry/backoff, which looks identical to "the architecture is slow" but
  // isn't. Spacing turns out (set E2E_TURN_GAP_MS=0 to disable and see the
  // rate-limited back-to-back behavior instead) isolates genuine pipeline
  // latency from that account-tier ceiling.
  const turnGapMs = process.env.E2E_TURN_GAP_MS ? Number(process.env.E2E_TURN_GAP_MS) : 16000;

  const results: TurnTiming[] = [];
  for (const transcript of SAMPLE_TURNS) {
    // Fresh sessionId AND userId per turn — a real caller is a fresh phone
    // number every call, and this harness previously reused one userId
    // across every run today, letting accumulated LTM_user memory from
    // unrelated earlier test invocations bleed into retrieval/policy for
    // later ones (surfaced live: every turn getting an "I'm really sorry
    // this is happening" opener regardless of content, and one reply about
    // "canceling" in response to an hours question — contamination, not a
    // real pipeline behavior).
    const runId = nanoid(8);
    const sessionId = `latency-harness-${runId}`;
    const userId = `latency-harness-user-${runId}`;
    console.log(`--- Turn: "${transcript}" ---`);
    try {
      const timing = await runOneTurn(transcript, sessionId, userId);
      results.push(timing);
      if (turnGapMs > 0) await new Promise((r) => setTimeout(r, turnGapMs));
      console.log(`  Speak WS connect (pre-warmed, NOT counted below): ${timing.connectMs}ms`);
      console.log(`  pre-LLM (emotion+retrieval+memory): ${timing.preLlmMs}ms`);
      console.log(`  time to first clause (LLM TTFT):     ${timing.ttfcMs}ms   [first clause: "${timing.firstClause}"]`);
      console.log(`  time to first TTS audio byte:        ${timing.ttfaMs}ms`);
      console.log(`  >>> TOTAL TIME TO FIRST SOUND:       ${timing.totalToFirstAudioMs}ms`);
      console.log(`  (for comparison — full reply done:   ${timing.fullReplyMs}ms)`);
    } catch (err) {
      console.error(`  FAILED:`, err);
    }
    console.log("");
  }

  const valid = results.filter((r) => !Number.isNaN(r.totalToFirstAudioMs));
  if (valid.length > 0) {
    const totals = valid.map((r) => r.totalToFirstAudioMs);
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    const max = Math.max(...totals);
    const min = Math.min(...totals);
    console.log("=== SUMMARY (time to first sound, network + real LLM + real TTS) ===");
    console.log(`  min: ${min}ms   avg: ${Math.round(avg)}ms   max: ${max}ms`);
    console.log(`  ${valid.filter((r) => r.totalToFirstAudioMs < 1000).length}/${valid.length} turns under 1000ms`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Harness failed:", err);
  process.exit(1);
});
