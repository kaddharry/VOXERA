import { CONFIG } from "../config";

/** True when the text is plain English/Latin: Deepgram Aura is English-only, so it cannot voice Indic text. */
export function isLatinText(text: string): boolean {
  return !/[ऀ-෿]/.test(text);
}

/**
 * Last-resort voice for ONE English clause when Gnani's TTS is down: raw linear16 PCM at the call's
 * sample rate straight from Deepgram Aura. A different voice for a sentence beats a hole in the reply.
 */
export async function synthesizeDeepgramRaw(text: string, sampleRate: number): Promise<Buffer> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(CONFIG.deepgram.ttsModel)}&encoding=linear16&sample_rate=${sampleRate}&container=none`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Deepgram TTS fallback failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
