/**
 * Measures where a turn's time goes, through the real orchestrator: time to the FIRST SPOKEN CLAUSE (what the
 * caller waits for) and the orchestrator's own stage timings. Text in, so it excludes STT and TTS.
 * Run: npx tsx --env-file=.env.local scripts/latency-probe.ts
 */
import { handleTurn } from "../lib/agent/orchestrator";
import { supabase } from "../lib/db/supabase";

const CLIENT = "e9215284-4095-4333-9fd3-e073c7e6c805";
const AARTI = "a5f7133c-16f8-484f-a096-1082741e4377";
const PATIENT = "2QIa9RiM3nXN";

(async () => {
  const realLog = console.log, realWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  const out = (...a: unknown[]) => realLog(...a);
  const session = `lat-${Date.now()}`;
  const turns = [
    "Yes, this is Vikas speaking.",
    "I have a little pain in my legs.",
    "Can I get an appointment tomorrow?",
    "Ten o'clock works.",
  ];
  out("turn".padEnd(36), "first clause", "emotion", "retrieval", "llm", "total");
  for (const text of turns) {
    const t0 = Date.now();
    let first = 0;
    const r = await handleTurn(
      { sessionId: session, userId: session, clientId: CLIENT, agentId: AARTI, patientId: PATIENT, transcript: text, sttConfidence: 0.9, language: "auto" },
      { onReplyChunk: () => { if (!first) first = Date.now() - t0; } } as any,
    );
    const tm: any = r.trace.timings ?? {};
    out(text.slice(0, 34).padEnd(36), String(first).padStart(8) + "ms", String(tm.emotionMs ?? "").padStart(6), String(tm.retrievalMs ?? "").padStart(8), String(tm.llmMs ?? "").padStart(6), String(tm.totalMs ?? Date.now() - t0).padStart(6), "| model:", r.trace.llmModel);
  }
  await supabase.from("session_logs").delete().eq("sessionId", session);
  await supabase.from("memories").delete().eq("userId", session);
  console.log = realLog; console.warn = realWarn;
  process.exit(0);
})();
