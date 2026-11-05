/**
 * Real end-to-end latency harness for Gnani-routed (Indian-language) calls —
 * same methodology as scripts/e2e_latency_test.ts, but exercises the ACTUAL
 * production Gnani path: lib/agent/orchestrator.ts's handleTurn() (with
 * language set, so the XLM-EMO emotion path and the language-matching
 * system-prompt rule both actually run) + lib/tts/gnani-stream.ts's
 * GnaniSpeakStream, over the real network against the real Groq LLM and the
 * real Gnani TTS Realtime WebSocket. Twilio itself is the only thing not
 * exercised.
 *
 * Usage: npx tsx --env-file=.env.local scripts/e2e_latency_test_gnani.ts
 */
import { handleTurn } from "../lib/agent/orchestrator";
import { createSpeakStream } from "../lib/speech/factory";
import { warmupModels } from "../lib/warmup";
import { nanoid } from "nanoid";

const SAMPLE_TURNS: { transcript: string; language: string }[] = [
  { transcript: "Hello, mujhe aaj shaam 7 baje ke liye do logo ka table chahiye.", language: "hi-en" },
  { transcript: "Saturday ko aapka timing kya hai?", language: "hi-en" },
  { transcript: "मुझे बहुत गुस्सा आ रहा है, यह तीसरी बार है जब मेरा ऑर्डर गलत आया!", language: "hi-IN" },
];

interface TurnTiming {
  transcript: string;
  language: string;
  preLlmMs: number;
  ttfcMs: number;
  ttfaMs: number;
  totalToFirstAudioMs: number;
  fullReplyMs: number;
  firstClause: string;
  replyText: string;
  connectMs: number;
}

/** Connects the Gnani Speak stream BEFORE the timer starts — matches
 * production (lib/telephony/stream-handler.ts's setupVoiceForCall(), which
 * opens this connection as soon as the agent/provider is resolved, seconds
 * before the caller finishes their first sentence). */
async function connectSpeakStream(onFirstAudio: () => void, language: string) {
  const stream = createSpeakStream(
    "gnani",
    { sampleRate: 8000, language, voice: "Nalini", gnaniModel: "timbre-v2.5" },
    () => onFirstAudio()
  );
  const connectStart = performance.now();
  await stream.connect();
  return { stream, connectMs: Math.round(performance.now() - connectStart) };
}

async function runOneTurn(transcript: string, language: string, sessionId: string, userId: string): Promise<TurnTiming> {
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
  }, language);

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
      language,
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

  await Promise.race([firstAudioPromise, new Promise((r) => setTimeout(r, 8000))]);

  speakStream.close();

  const ttfc = (firstClauseAt ?? fullReplyAt) - t0;
  const ttfa = firstAudioAt !== null && firstClauseAt !== null ? firstAudioAt - firstClauseAt : NaN;

  return {
    transcript,
    language,
    preLlmMs: output.trace.timings ? output.trace.timings.emotionMs : NaN,
    ttfcMs: Math.round(ttfc),
    ttfaMs: Math.round(ttfa),
    totalToFirstAudioMs: firstAudioAt !== null ? Math.round(firstAudioAt - t0) : NaN,
    fullReplyMs: Math.round(fullReplyAt - t0),
    firstClause: firstClauseText,
    replyText: output.reply,
    connectMs,
  };
}

async function main() {
  console.log("=== VOXERA Gnani (Indian-language) End-to-End Latency Harness ===\n");
  console.log("Warming up ONNX models (simulates steady-state server, not cold boot)...");
  await warmupModels();
  console.log("");

  const turnGapMs = process.env.E2E_TURN_GAP_MS ? Number(process.env.E2E_TURN_GAP_MS) : 16000;

  const results: TurnTiming[] = [];
  for (const { transcript, language } of SAMPLE_TURNS) {
    const runId = nanoid(8);
    const sessionId = `latency-harness-gnani-${runId}`;
    const userId = `latency-harness-gnani-user-${runId}`;
    console.log(`--- Turn (${language}): "${transcript}" ---`);
    try {
      const timing = await runOneTurn(transcript, language, sessionId, userId);
      results.push(timing);
      if (turnGapMs > 0) await new Promise((r) => setTimeout(r, turnGapMs));
      console.log(`  Speak WS connect (pre-warmed, NOT counted below): ${timing.connectMs}ms`);
      console.log(`  pre-LLM (emotion+retrieval+memory):  ${timing.preLlmMs}ms`);
      console.log(`  time to first clause (LLM TTFT):     ${timing.ttfcMs}ms   [first clause: "${timing.firstClause}"]`);
      console.log(`  time to first TTS audio byte:        ${timing.ttfaMs}ms`);
      console.log(`  >>> TOTAL TIME TO FIRST SOUND:       ${timing.totalToFirstAudioMs}ms`);
      console.log(`  (full reply, for reference)          ${timing.fullReplyMs}ms — "${timing.replyText}"`);
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
    console.log("=== SUMMARY (time to first sound, network + real Groq LLM + real Gnani TTS) ===");
    console.log(`  min: ${min}ms   avg: ${Math.round(avg)}ms   max: ${max}ms`);
    console.log(`  ${valid.filter((r) => r.totalToFirstAudioMs < 1000).length}/${valid.length} turns under 1000ms`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Harness failed:", err);
  process.exit(1);
});
