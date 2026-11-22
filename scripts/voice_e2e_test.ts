/**
 * Usage: start `npm run server` (or REALTIME_SERVER_PORT=3011 npx tsx --env-file=.env.local server.ts), then
 *   REALTIME_SERVER_PORT=3011 npx tsx --env-file=.env.local scripts/voice_e2e_test.ts [all|lang|interact] [Hindi,Tamil,...]
 * Needs GNANI_API_KEY (the "caller" is Gnani TTS). Writes /tmp/voice-e2e-report.json (REPORT_OUT to change).
 *
 * Speech-driven e2e against the REAL running server.ts: Gnani TTS plays the
 * "caller", audio is streamed as 16kHz PCM in real time, and every server
 * message is timestamped.
 */
import WebSocket from "ws";
import { writeFileSync } from "node:fs";

const PORT = process.env.REALTIME_SERVER_PORT || "3011";
const AGENT_ID = process.env.AGENT_ID || "a76eb86b-a771-4d3f-990f-bbeb7a389bad";
const CLIENT_ID = "e9215284-4095-4333-9fd3-e073c7e6c805";
const OUT_RATE = 24000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ttsCache = new Map<string, Buffer>();
async function callerAudio(text: string, language: string, voice = "Avinash"): Promise<Buffer> {
  const k = `${language}|${text}`;
  if (ttsCache.has(k)) return ttsCache.get(k)!;
  const r = await fetch("https://api.vachana.ai/api/v1/tts/inference", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key-ID": process.env.GNANI_API_KEY! },
    body: JSON.stringify({ text, model: "timbre-v3.0", voice, language, speed: 1.0, audio_config: { sample_rate: 16000, num_channels: 1, sample_width: 2, encoding: "linear_pcm", container: "raw" } }),
  });
  if (!r.ok) throw new Error(`caller TTS ${r.status} ${await r.text()}`);
  const b = Buffer.from(await r.arrayBuffer());
  ttsCache.set(k, b);
  return b;
}

interface Ev { t: number; type: string; [k: string]: any }
class Session {
  ws!: WebSocket; t0 = Date.now(); events: Ev[] = []; audioMs = 0;
  async open() {
    this.ws = new WebSocket(`ws://localhost:${PORT}?agentId=${AGENT_ID}&clientId=${CLIENT_ID}`);
    this.ws.on("message", (raw, isBin) => {
      if (isBin) return;
      const m = JSON.parse(raw.toString());
      const ev: Ev = { t: Date.now(), type: m.type };
      if (m.type === "reply_audio_chunk") { ev.bytes = Buffer.from(m.audio, "base64").length; ev.turnId = m.turnId; }
      else { ev.text = m.text; ev.turnId = m.turnId; ev.message = m.message; if (m.trace?.timings) ev.timings = m.trace.timings; if (m.trace?.emotion) ev.emo = m.trace.emotion.current?.label; }
      this.events.push(ev);
    });
    await new Promise<void>((res, rej) => { this.ws.on("open", () => res()); this.ws.on("error", rej); });
  }
  mark() { return this.events.length; }
  since(i: number) { return this.events.slice(i); }
  /** Streams PCM16 at real-time cadence. Returns the epoch ms when the last frame of SPEECH was sent. */
  async speak(pcm: Buffer, trailSilenceMs = 1800, opts: { gain?: number } = {}) {
    const FRAME = 640; // 20ms @16k
    for (let o = 0; o < pcm.length; o += FRAME) {
      let f = pcm.subarray(o, Math.min(o + FRAME, pcm.length));
      if (opts.gain && opts.gain !== 1) { const c = Buffer.from(f); for (let i = 0; i + 1 < c.length; i += 2) c.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(c.readInt16LE(i) * opts.gain))), i); f = c; }
      this.ws.send(f);
      await sleep(20);
    }
    const speechEnd = Date.now();
    const sil = Buffer.alloc(FRAME);
    for (let ms = 0; ms < trailSilenceMs; ms += 20) { this.ws.send(sil); await sleep(20); }
    return speechEnd;
  }
  async idleFor(ms: number) { const sil = Buffer.alloc(640); for (let i = 0; i < ms / 20; i++) { this.ws.send(sil); await sleep(20); } }
  async waitFor(pred: () => boolean, timeoutMs: number) { const s = Date.now(); while (Date.now() - s < timeoutMs) { if (pred()) return true; await sleep(25); } return false; }
  close() { try { this.ws.close(); } catch {} }
}

function summarize(evs: Ev[], speechEnd: number) {
  const first = (type: string) => evs.find((e) => e.type === type);
  const fin = first("transcript_final"), ts = first("turn_start"), rt = evs.find((e) => e.type === "reply_text"), te = first("turn_end");
  const chunks = evs.filter((e) => e.type === "reply_audio_chunk");
  const audioSec = chunks.reduce((a, c) => a + c.bytes / 2 / OUT_RATE, 0);
  return {
    sttFinalMs: fin ? fin.t - speechEnd : null, // end of caller speech -> final transcript
    transcript: evs.filter((e) => e.type === "transcript_final").map((e) => e.text).join(" | "),
    firstAudioFromFinalMs: fin && chunks[0] ? chunks[0].t - fin.t : null, // LLM + TTS time-to-first-audio
    firstAudioFromSpeechEndMs: chunks[0] ? chunks[0].t - speechEnd : null, // what the caller feels
    replyText: rt?.text ?? null,
    llmMs: rt?.timings?.llmMs ?? null,
    emo: rt?.emo ?? null,
    audioSec: +audioSec.toFixed(1),
    chunkCount: chunks.length,
    errors: evs.filter((e) => e.type === "error").map((e) => e.message),
    turnStartMs: ts && fin ? ts.t - fin.t : null,
    turnEnded: !!te,
  };
}

// ───────────── Language scenarios ─────────────
const LANGS: { name: string; code: string; turns: string[] }[] = [
  { name: "Hindi", code: "hi-IN", turns: ["नमस्ते, मैं ठीक हूँ।", "मुझे सिर में थोड़ा दर्द है, क्या मुझे डॉक्टर से मिलना चाहिए?"] },
  { name: "English", code: "en-IN", turns: ["Hello, I'm doing fine, thank you.", "I want to book a follow up appointment for tomorrow morning."] },
  { name: "Hinglish", code: "hi-en", turns: ["Hello, haan main theek hoon, bas thoda weak feel kar raha hoon.", "Mujhe agle hafte ka appointment chahiye, Monday ko possible hai?"] },
  { name: "Tamil", code: "ta-IN", turns: ["வணக்கம், நான் நலமாக இருக்கிறேன்.", "எனக்கு கொஞ்சம் காய்ச்சல் இருக்கிறது, என்ன செய்யலாம்?"] },
  { name: "Telugu", code: "te-IN", turns: ["నమస్కారం, నేను బాగున్నాను.", "నాకు కొంచెం కడుపు నొప్పిగా ఉంది, నేను ఏమి చేయాలి?"] },
  { name: "Kannada", code: "kn-IN", turns: ["ನಮಸ್ಕಾರ, ನಾನು ಚೆನ್ನಾಗಿದ್ದೇನೆ.", "ನನಗೆ ಸ್ವಲ್ಪ ತಲೆನೋವು ಇದೆ, ಏನು ಮಾಡಬೇಕು?"] },
  { name: "Malayalam", code: "ml-IN", turns: ["നമസ്കാരം, എനിക്ക് സുഖമാണ്.", "എനിക്ക് ചെറിയ ചുമയുണ്ട്, ഡോക്ടറെ കാണണോ?"] },
  { name: "Marathi", code: "mr-IN", turns: ["नमस्कार, मी ठीक आहे.", "मला थोडं पोट दुखतंय, मी काय करू?"] },
  { name: "Bengali", code: "bn-IN", turns: ["নমস্কার, আমি ভালো আছি।", "আমার একটু মাথা ব্যথা করছে, আমি কী করব?"] },
  { name: "Gujarati", code: "gu-IN", turns: ["નમસ્તે, હું ઠીક છું.", "મને થોડો તાવ છે, મારે શું કરવું જોઈએ?"] },
  { name: "Punjabi", code: "pa-IN", turns: ["ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ ਠੀਕ ਹਾਂ।", "ਮੈਨੂੰ ਥੋੜ੍ਹਾ ਸਿਰ ਦਰਦ ਹੈ, ਮੈਂ ਕੀ ਕਰਾਂ?"] },
];

async function languageSuite(only?: string[]) {
  const results: any[] = [];
  for (const L of LANGS.filter((l) => !only || only.includes(l.name))) {
    const s = new Session();
    await s.open();
    await s.waitFor(() => s.events.some((e) => e.type === "reply_audio_chunk" || e.type === "reply_text"), 8000); // greeting
    await s.waitFor(() => false, 3500); // let greeting audio finish arriving
    for (const [i, text] of L.turns.entries()) {
      const pcm = await callerAudio(text, L.code);
      const m = s.mark();
      const speechEnd = await s.speak(pcm, 1800);
      await s.waitFor(() => s.since(m).some((e) => e.type === "turn_end"), 25000);
      await sleep(2500);
      const r = { lang: L.name, turn: i + 1, said: text, ...summarize(s.since(m), speechEnd) };
      results.push(r);
      console.log(`[${L.name} #${i + 1}] said: ${text}\n   heard: ${r.transcript}\n   agent: ${r.replyText}\n   sttFinal=${r.sttFinalMs}ms firstAudio(after final)=${r.firstAudioFromFinalMs}ms felt=${r.firstAudioFromSpeechEndMs}ms llm=${r.llmMs} audio=${r.audioSec}s ${r.errors.length ? "ERR " + r.errors : ""}`);
    }
    s.close();
    await sleep(1500);
  }
  return results;
}

// ───────────── Barge-in & turn-taking ─────────────
async function interactionSuite() {
  const out: any[] = [];
  const rec = (name: string, pass: boolean, detail: string) => { out.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`); };
  const q1 = await callerAudio("मुझे अपना फॉलो-अप अपॉइंटमेंट बुक करना है, कृपया मुझे सारी जानकारी बताइए।", "hi-IN");
  const interrupt = await callerAudio("रुकिए रुकिए, मुझे कुछ और पूछना है।", "hi-IN");
  const hi2 = await callerAudio("ठीक है, कल सुबह दस बजे चलेगा।", "hi-IN");

  // 1. client-VAD barge-in during agent speech
  {
    const s = new Session(); await s.open(); await s.waitFor(() => false, 5000);
    let m = s.mark(); await s.speak(q1, 1500);
    const gotAudio = await s.waitFor(() => s.since(m).some((e) => e.type === "reply_audio_chunk"), 20000);
    if (!gotAudio) rec("barge-in (client VAD message)", false, "agent never started speaking");
    else {
      const tBarge = Date.now(); s.ws.send(JSON.stringify({ type: "barge_in" }));
      await sleep(1500);
      const after = s.since(m).filter((e) => e.type === "reply_audio_chunk" && e.t > tBarge + 300).length;
      const turnEnded = s.since(m).some((e) => e.type === "turn_end");
      rec("barge-in (client VAD message) stops audio", after === 0, `${after} audio chunks arrived >300ms after barge_in; turn_end=${turnEnded}`);
      // recovery: next utterance answered
      m = s.mark(); const se = await s.speak(hi2, 1800);
      await s.waitFor(() => s.since(m).some((e) => e.type === "reply_audio_chunk"), 20000);
      const sm = summarize(s.since(m), se);
      rec("recovers after barge-in (next turn answered)", !!sm.replyText && sm.chunkCount > 0, `heard="${sm.transcript}" reply="${sm.replyText}"`);
    }
    s.close();
  }
  // 2. server-side RMS barge-in: loud speech while agent talks, NO barge_in message
  {
    const s = new Session(); await s.open(); await s.waitFor(() => false, 5000);
    let m = s.mark(); await s.speak(q1, 1500);
    const gotAudio = await s.waitFor(() => s.since(m).some((e) => e.type === "reply_audio_chunk"), 20000);
    if (!gotAudio) rec("barge-in (server RMS fallback)", false, "agent never started speaking");
    else {
      const tBarge = Date.now();
      s.speak(interrupt, 0, { gain: 1.6 }); // loud caller talk, fire and forget
      await sleep(2500);
      const after = s.since(m).filter((e) => e.type === "reply_audio_chunk" && e.t > tBarge + 400).length;
      rec("barge-in (server RMS fallback) stops audio", after === 0, `${after} chunks >400ms after caller started talking over the agent`);
    }
    await sleep(3000); s.close();
  }
  // 3. barge-in BEFORE first audio (during LLM thinking): no stale audio afterwards
  {
    const s = new Session(); await s.open(); await s.waitFor(() => false, 5000);
    const m = s.mark(); await s.speak(q1, 1200);
    await s.waitFor(() => s.since(m).some((e) => e.type === "turn_start"), 15000);
    s.ws.send(JSON.stringify({ type: "barge_in" }));
    const tB = Date.now(); await sleep(6000);
    const stale = s.since(m).filter((e) => e.type === "reply_audio_chunk" && e.t > tB).length;
    rec("barge-in during thinking drops stale reply audio", stale === 0, `${stale} stale audio chunks after barge-in`);
    s.close();
  }
  // 4. overlapping second utterance while agent is mid-turn (turn-taking)
  {
    const s = new Session(); await s.open(); await s.waitFor(() => false, 5000);
    const m = s.mark(); await s.speak(q1, 1200);
    await s.waitFor(() => s.since(m).some((e) => e.type === "turn_start"), 15000);
    await s.speak(hi2, 1800); // speaks while agent is generating, no barge_in sent
    await s.waitFor(() => false, 9000);
    const finals = s.since(m).filter((e) => e.type === "transcript_final").length;
    const replies = s.since(m).filter((e) => e.type === "reply_text").length;
    rec("second utterance during a turn is not silently lost", replies >= 2 || finals < 2, `final transcripts=${finals}, agent replies=${replies}`);
    s.close();
  }
  // 5. silence only -> no spurious reply
  {
    const s = new Session(); await s.open(); await s.waitFor(() => false, 5000);
    const m = s.mark(); await s.idleFor(8000);
    const replies = s.since(m).filter((e) => e.type === "reply_text" || e.type === "reply_audio_chunk").length;
    rec("8s of silence produces no reply", replies === 0, `${replies} unexpected reply events`);
    s.close();
  }
  // 6. caller talks over the greeting
  {
    const s = new Session(); await s.open();
    await s.waitFor(() => s.events.some((e) => e.type === "reply_audio_chunk"), 12000);
    const m = s.mark(); const se = await s.speak(hi2, 1800);
    await s.waitFor(() => s.since(m).some((e) => e.type === "reply_text" && e.turnId), 20000);
    await sleep(3000);
    const sm = summarize(s.since(m), se);
    rec("caller speaking during greeting still gets an answer", !!sm.replyText, `heard="${sm.transcript}" reply="${sm.replyText}"`);
    s.close();
  }
  // 7. long pause mid-sentence (thinking pause) shouldn't cut the caller off into 2 turns
  {
    const s = new Session(); await s.open(); await s.waitFor(() => false, 5000);
    const a = await callerAudio("मुझे अपॉइंटमेंट चाहिए", "hi-IN"), b = await callerAudio("कल सुबह के लिए।", "hi-IN");
    const m = s.mark(); await s.speak(a, 700); const se = await s.speak(b, 2000);
    await s.waitFor(() => s.since(m).some((e) => e.type === "turn_end"), 20000); await sleep(3000);
    const finals = s.since(m).filter((e) => e.type === "transcript_final").length;
    const replies = s.since(m).filter((e) => e.type === "reply_text").length;
    rec("0.7s mid-sentence pause (info: how many turns it split into)", true, `final transcripts=${finals}, agent replies=${replies} (1 = ideal)`);
    s.close();
  }
  return out;
}

(async () => {
  const mode = process.argv[2] || "all";
  const only = process.argv[3]?.split(",");
  const report: any = {};
  if (mode === "all" || mode === "lang") report.languages = await languageSuite(only);
  if (mode === "all" || mode === "interact") report.interaction = await interactionSuite();
  writeFileSync(process.env.REPORT_OUT || "/tmp/voice-e2e-report.json", JSON.stringify(report, null, 2));
  process.exit(0);
})();
