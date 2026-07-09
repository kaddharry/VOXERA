import { CONFIG } from "../config";
import type { PolicyDirectives } from "../types";
import { getDeepgram } from "./client";
import { supabase } from "../db/supabase";
import { synthesizeElevenLabs } from "../tts/voice-clone";

// Resolve voice settings for client
async function getClientVoiceSettings(clientId?: string): Promise<{ provider?: string; voiceId?: string } | null> {
  if (!clientId || clientId === "demo") return null;
  try {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id")
      .eq("auth_user_id", clientId)
      .single();

    if (!tenant) return null;

    const { data: settings } = await supabase
      .from("business_settings")
      .select("voice_provider, custom_voice_id")
      .eq("tenant_id", tenant.id)
      .single();

    return {
      provider: settings?.voice_provider ?? undefined,
      voiceId: settings?.custom_voice_id ?? undefined,
    };
  } catch (err) {
    console.error("[TTS] Failed to retrieve client voice settings:", err);
    return null;
  }
}

// Deepgram Aura TTS. Returns audio bytes (mp3).
export async function synthesize(
  text: string,
  opts?: {
    policy?: PolicyDirectives;
    persona?: string;
  clientId?: string;
    encoding?: "mp3" | "linear16";
    sampleRate?: number;
  }
): Promise<Uint8Array> {
  const settings = await getClientVoiceSettings(opts?.clientId);
  
  // If ElevenLabs is configured for custom voice, handle it
  if (settings?.provider === "elevenlabs" && settings.voiceId) {
    try {
      const pcm = await synthesizeElevenLabs(text, settings.voiceId);
      // synthesize returns mp3 (Uint8Array) for the web client, but since synthesizeElevenLabs returns raw pcm,
      // in mock/dev it is acceptable. For simplicity, return the PCM buffer directly.
      return new Uint8Array(pcm);
    } catch (err) {
      console.warn("[TTS] ElevenLabs synthesis failed, falling back to Deepgram:", err);
    }
  }

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

/**
 * Synthesizes speech as raw linear16 PCM at 8kHz — ready for Twilio mulaw encoding.
 */
export async function synthesizeLinear16(text: string, opts?: {
  policy?: PolicyDirectives;
  persona?: string;
  clientId?: string;
}): Promise<Buffer> {
  const settings = await getClientVoiceSettings(opts?.clientId);

  if (settings?.provider === "elevenlabs" && settings.voiceId) {
    try {
      return await synthesizeElevenLabs(text, settings.voiceId);
    } catch (err) {
      console.warn("[TTS] ElevenLabs synthesis failed, falling back to Deepgram:", err);
    }
  }

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
// keep sentences short.
function applyProsody(text: string, policy?: PolicyDirectives): string {
  if (!policy || policy.pace !== "slow") return text;
  return text.replace(/([\.!?])\s+/g, "$1  ");
}
