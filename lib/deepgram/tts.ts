import { CONFIG } from "../config";
import type { PolicyDirectives } from "../types";
import { getDeepgram } from "./client";

// Deepgram Aura TTS. Returns audio bytes (mp3).
// For low-latency voice agents, stream with client.speak.v1.connect (WebSocket)
// — this REST path is fine for non-streaming replies and demos.
export async function synthesize(
  text: string,
  opts?: {
    policy?: PolicyDirectives;
    persona?: string;
    encoding?: "mp3" | "linear16";
    sampleRate?: number;
  }
): Promise<Uint8Array> {
  const dg = getDeepgram();
  const shaped = applyProsody(text, opts?.policy);

  const personaConfig = opts?.persona
    ? CONFIG.deepgram.voicePersonas[opts.persona as keyof typeof CONFIG.deepgram.voicePersonas]
    : undefined;
  const model = personaConfig?.model || CONFIG.deepgram.ttsModel;

  // Retry TTS up to 2 times on transient failures (502/503/network errors)
  const MAX_TTS_RETRIES = 2;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_TTS_RETRIES; attempt++) {
    try {
      const binary = await dg.speak.v1.audio.generate({
        text: shaped,
        model,
        encoding: opts?.encoding ?? "mp3",
        sample_rate: opts?.sampleRate,
      });

      
      const buf = await binary.arrayBuffer();
      return new Uint8Array(buf);
    } catch (err: any) {
      lastErr = err;
      if (attempt < MAX_TTS_RETRIES) {
        const backoff = (attempt + 1) * 500;
        console.warn(
          `[TTS] Attempt ${attempt + 1} failed: ${err.message ?? err}. Retrying in ${backoff}ms...`
        );
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  throw lastErr;
}

// Light prosody adaptation: under slow pacing, insert subtle pauses and
// keep sentences short. Deepgram Aura does not accept SSML, so we rely on
// punctuation and pacing cues that the model respects.
function applyProsody(text: string, policy?: PolicyDirectives): string {
  if (!policy || policy.pace !== "slow") return text;
  return text.replace(/([\.!?])\s+/g, "$1  ");
}
