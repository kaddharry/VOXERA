/**
 * REAL end-to-end latency: a fake caller streams synthesized speech to the running test-call WebSocket in real
 * time (100 ms chunks, like the browser) and times how long until the agent's first audio comes back.
 * Needs the dev server running (npm run dev). Reports, per turn, what the server measured:
 *   listen (caller stopped -> transcript), think (transcript -> first sentence), voice (-> first audio),
 *   and FIRST WORD (caller stopped -> first audio): what a caller actually waits for.
 * Run: npx tsx --env-file=.env.local scripts/latency-e2e.ts
 */
import WebSocket from "ws";
import { synthesizeDeepgramRaw } from "../lib/tts/deepgram-fallback";
import { supabase } from "../lib/db/supabase";
import { dispatchToolCall } from "../lib/agent/tools";

const AARTI = "a5f7133c-16f8-484f-a096-1082741e4377";
const PATIENT = "2QIa9RiM3nXN";
const URL = `ws://localhost:3000/api/test-agent/stream?agentId=${AARTI}&patientId=${PATIENT}`;
const UTTERANCES = ["Yes, this is Vikas speaking.", "I have a little pain in my legs.", "Can I get an appointment tomorrow?", "Ten o'clock works for me."];
const CHUNK = 3200; // 100 ms of 16 kHz mono int16

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The fake caller's booking request is real: the agent books through the real tools. Remember what existed
 * before so ONLY what this run created is removed afterwards. */
async function appointmentIds(): Promise<Set<string>> {
  const r = await supabase.from("appointments").select("id").eq("patient_id", PATIENT).neq("status", "cancelled");
  return new Set((r.data ?? []).map((a: any) => a.id as string));
}

(async () => {
  const before = await appointmentIds();
  const ws = new WebSocket(URL);
  let lastAudioAt = 0;
  let firstAudioAfterSpeech = 0;
  let speechEndedAt = 0;
  const replies: Array<{ turnId: string; text: string; latency?: any; clientFirstWordMs?: number }> = [];
  const latencyByTurn = new Map<string, any>();
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    const m = JSON.parse(String(data));
    if (m.type === "reply_audio_chunk") {
      lastAudioAt = Date.now();
      if (speechEndedAt && !firstAudioAfterSpeech) firstAudioAfterSpeech = Date.now();
    }
    if (m.type === "latency") latencyByTurn.set(m.turnId, m.latency);
    if (m.type === "reply_text") replies.push({ turnId: m.turnId, text: m.text, latency: m.latency });
  });
  await new Promise<void>((res, rej) => { ws.on("open", () => res()); ws.on("error", rej); });
  console.log("connected; waiting for the greeting to finish…");
  // keep the line alive with silence while the greeting plays
  const quiet = Buffer.alloc(CHUNK);
  let silentFor = 0;
  while (silentFor < 2500) { ws.send(quiet); await sleep(100); silentFor = Date.now() - lastAudioAt < 1500 ? 0 : silentFor + 100; if (Date.now() - lastAudioAt < 1500) silentFor = 0; }

  console.log("\n#  utterance".padEnd(40), "first word", " listen", "  think", "  voice", " (server ms)");
  for (let i = 0; i < UTTERANCES.length; i++) {
    const pcm = await synthesizeDeepgramRaw(UTTERANCES[i], 16000);
    const before = replies.length;
    firstAudioAfterSpeech = 0; speechEndedAt = 0;
    for (let o = 0; o < pcm.length; o += CHUNK) { ws.send(pcm.subarray(o, o + CHUNK)); await sleep(100); }
    speechEndedAt = Date.now();
    // silence so the recogniser's end-of-speech fires, until the reply completes
    const deadline = Date.now() + 40_000;
    while (replies.length === before && Date.now() < deadline) { ws.send(quiet); await sleep(100); }
    const r = replies[replies.length - 1];
    // let the reply's audio arrive and finish before the next utterance (speaking earlier is a real barge-in that
    // cuts the reply off): wait up to 12 s for audio to start, then for 1.5 s of quiet after it
    const waitUntil = Date.now() + 12_000;
    while (!firstAudioAfterSpeech && Date.now() < waitUntil) { ws.send(quiet); await sleep(100); }
    let q = 0; while (q < 1500) { ws.send(quiet); await sleep(100); q = Date.now() - lastAudioAt < 1200 ? 0 : q + 100; }
    const L = r ? latencyByTurn.get(r.turnId) : undefined;
    console.log(`${String(i + 1).padStart(2)} ${UTTERANCES[i].slice(0, 32).padEnd(33)} ${String(L?.firstWordMs ?? "–").padStart(8)}ms ${String(L?.listenMs ?? "–").padStart(6)} ${String(L?.thinkMs ?? "–").padStart(7)} ${String(L?.voiceMs ?? "–").padStart(7)} | "${(r?.text ?? "").slice(0, 55)}"`);
  }
  ws.close();
  await sleep(1500);
  for (const id of await appointmentIds()) {
    if (before.has(id)) continue;
    await dispatchToolCall("cancel_appointment", { appointmentId: id, reason: "latency test cleanup" }, { clientId: "e9215284-4095-4333-9fd3-e073c7e6c805", patientId: PATIENT }).catch(() => {});
    await supabase.from("appointments").delete().eq("id", id);
    console.log("removed the test booking", id.slice(0, 8));
  }
  process.exit(0);
})();
