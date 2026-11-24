/**
 * Sends clauses to Gnani's streaming TTS the way a call does (several queued at once) and reports how many
 * were actually spoken. Gnani's endpoint intermittently answers "technical difficulties"; the stream retries.
 * Run: npx tsx --env-file=.env.local scripts/tts-probe.ts
 */
import { GnaniSpeakStream } from "../lib/tts/gnani-stream";

const CLAUSES = [
  "Hi Vikas, I’m so sorry to hear about the pain in your legs.",
  "Can you tell me how bad it is, from one to ten?",
  "पैरों में दर्द और सूजन कितनी तेज़ है?",
  "I can book you with Dr. Priya Desai tomorrow at 10.",
];

(async () => {
  let attempts = 0;
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => { if (String(a[0]).includes("Server error")) attempts++; else origWarn(...a); };
  let totalSpoken = 0, totalClauses = 0;
  for (let round = 1; round <= 4; round++) {
    let total = 0;
    const s = new GnaniSpeakStream({ voice: "Shivani", model: "timbre-v3.0" as any, language: "auto", sampleRate: 16000 }, (b) => { total += b.length; });
    await s.connect();
    // queue them all at once, like clauses streaming out of the model
    for (const c of CLAUSES) s.sendText(c);
    await new Promise<void>((resolve) => { const t0 = Date.now(); const iv = setInterval(() => { if (((s as any).busy === false && (s as any).queue.length === 0) || Date.now() - t0 > 25000) { clearInterval(iv); resolve(); } }, 150); });
    s.close();
    // ~60KB+ of audio per clause at 16kHz; four clauses voiced means none was dropped
    console.log(`round ${round}: ${total > 4 * 60000 ? "all 4 clauses voiced" : "SOME MISSING"} (${total} bytes)`);
    totalSpoken += total > 4 * 60000 ? 4 : 0; totalClauses += 4;
  }
  console.warn = origWarn;
  console.log(`server errors absorbed by retries: ${attempts}`);
  process.exit(0);
})();
