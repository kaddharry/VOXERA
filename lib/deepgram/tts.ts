import { CONFIG } from "../config";
import type { PolicyDirectives } from "../types";
import { getDeepgram } from "./client";

// Deepgram Aura TTS. Returns audio bytes (mp3).
// For low-latency voice agents, stream with client.speak.v1.connect (WebSocket)
// — this REST path is fine for non-streaming replies and demos.
export async function synthesize(text: string, opts?: {
  policy?: PolicyDirectives;
  persona?: string;
}): Promise<Uint8Array> {
  const dg = getDeepgram();
  const shaped = applyProsody(text, opts?.policy);
  
  const personaConfig = opts?.persona ? CONFIG.deepgram.voicePersonas[opts.persona as keyof typeof CONFIG.deepgram.voicePersonas] : undefined;
  const model = personaConfig?.model || CONFIG.deepgram.ttsModel;

  const binary = await dg.speak.v1.audio.generate({
    text: shaped,
    model: model,
    encoding: "mp3",
  });
  const buf = await binary.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Synthesizes speech as raw linear16 PCM at 8kHz — ready for Twilio mulaw encoding.
 * Issue #4: The original synthesize() returns mp3, which can't be directly treated as PCM.
 */
export async function synthesizeLinear16(text: string, opts?: {
  policy?: PolicyDirectives;
  persona?: string;
}): Promise<Buffer> {
  const dg = getDeepgram();
  const shaped = applyProsody(text, opts?.policy);

  const personaConfig = opts?.persona ? CONFIG.deepgram.voicePersonas[opts.persona as keyof typeof CONFIG.deepgram.voicePersonas] : undefined;
  const model = personaConfig?.model || CONFIG.deepgram.ttsModel;

  const binary = await dg.speak.v1.audio.generate({
    text: shaped,
    model: model,
    encoding: "linear16",
    sample_rate: 8000,
    container: "none",
  });
  const buf = await binary.arrayBuffer();
  return Buffer.from(buf);
}

// Light prosody adaptation: under slow pacing, insert subtle pauses and
// keep sentences short. Deepgram Aura does not accept SSML, so we rely on
// punctuation and pacing cues that the model respects.
function applyProsody(text: string, policy?: PolicyDirectives): string {
  if (!policy || policy.pace !== "slow") return text;
  return text.replace(/([\.!?])\s+/g, "$1  ");
}
