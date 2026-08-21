import type { EmotionLabel, PolicyDirectives } from "../types";
import { taskCriticality } from "./importance";

// BUG-V1: this module used to compute a `speed`/`pitchHint` pair per emotion
// that nothing downstream ever read — Deepgram's TTS REST API has no speed
// or pitch parameter at all (verified against the SDK's own SpeakV1Request
// type: text/model/encoding/sample_rate/container/bit_rate only), so those
// fields were unusable through Deepgram regardless of whether the plumbing
// existed. This version replaces them with two levers that are actually
// applicable: `pauseStrategy` (text-level pacing, works for every TTS
// provider) and `elevenLabsVoiceSettings` (real acoustic control, applies
// only when a tenant has ElevenLabs configured — the only engine in this
// codebase whose API supports it).

export type ToneMode =
  | "appealing" // pleading/de-escalating — anger, frustration, distress
  | "dominant" // confident/directive — confusion, fear
  | "pleasing" // upbeat — joy, gratitude, excitement
  | "empathetic" // soft/patient — sadness, disappointment
  | "playful" // warm/light — calm, positive small talk (deliberately not "flirty" — see below)
  | "serious" // measured/precise — caller text hits a task-critical topic, overrides mood
  | "neutral";

/** ElevenLabs `voice_settings` fields, per ElevenLabs' documented ranges:
 * stability 0–1, style 0+ ("style exaggeration", costs more compute the
 * higher it goes — kept modest here), speed ~0.5–2 (1.0 = normal). */
export interface ElevenLabsVoiceSettings {
  stability: number;
  style: number;
  speed: number;
}

export interface TTSProsodyParams {
  toneMode: ToneMode;
  pauseStrategy: "none" | "subtle" | "long";
  elevenLabsVoiceSettings: ElevenLabsVoiceSettings;
}

const TONE_PROFILES: Record<ToneMode, Omit<TTSProsodyParams, "toneMode">> = {
  appealing: {
    pauseStrategy: "long",
    elevenLabsVoiceSettings: { stability: 0.65, style: 0.35, speed: 0.85 },
  },
  dominant: {
    pauseStrategy: "none",
    elevenLabsVoiceSettings: { stability: 0.75, style: 0.2, speed: 1.0 },
  },
  pleasing: {
    pauseStrategy: "none",
    elevenLabsVoiceSettings: { stability: 0.35, style: 0.5, speed: 1.08 },
  },
  empathetic: {
    pauseStrategy: "long",
    elevenLabsVoiceSettings: { stability: 0.8, style: 0.15, speed: 0.8 },
  },
  playful: {
    pauseStrategy: "subtle",
    elevenLabsVoiceSettings: { stability: 0.4, style: 0.5, speed: 1.0 },
  },
  serious: {
    pauseStrategy: "subtle",
    elevenLabsVoiceSettings: { stability: 0.85, style: 0.05, speed: 0.95 },
  },
  neutral: {
    pauseStrategy: "none",
    elevenLabsVoiceSettings: { stability: 0.5, style: 0.2, speed: 1.0 },
  },
};

// "flirty" was deliberately not built — a business receptionist adopting a
// flirty tone is a real professionalism/liability risk for every tenant
// using this agent. "playful" covers the same "more personality, less
// robotic" goal without that risk.
const EMOTION_TO_TONE: Record<EmotionLabel, ToneMode> = {
  neutral: "neutral",
  calm: "playful",
  frustration: "appealing",
  anger: "appealing",
  distress: "appealing",
  fear: "dominant",
  confusion: "dominant",
  joy: "pleasing",
  gratitude: "pleasing",
  excitement: "pleasing",
  sadness: "empathetic",
  disappointment: "empathetic",
};

/**
 * Resolves the tone mode + prosody params for a turn. Precedence:
 * 1. Serious/Formal — the caller's utterance hits a task-critical topic
 *    (payment, refund, legal, medical, safety, password...), regardless of
 *    mood. Playful/appealing pacing on a refund or legal turn reads as
 *    wrong even if the caller sounds calm.
 * 2. Appealing — policy already flagged escalation or "acknowledge first"
 *    (sustained negativity per policy.ts), even when the raw emotion label
 *    alone wouldn't trigger it.
 * 3. Plain emotion → tone mapping.
 */
export function getEmotionTTSParams(
  emotion?: EmotionLabel,
  policy?: PolicyDirectives,
  callerText?: string,
): TTSProsodyParams {
  let toneMode: ToneMode = "neutral";

  if (callerText && taskCriticality(callerText) > 0) {
    toneMode = "serious";
  } else if (policy && (policy.escalate !== "none" || policy.acknowledgeFirst)) {
    toneMode = "appealing";
  } else if (emotion) {
    toneMode = EMOTION_TO_TONE[emotion] ?? "neutral";
  }

  return { toneMode, ...TONE_PROFILES[toneMode] };
}

export function applyEmotionProsody(text: string, params: TTSProsodyParams): string {
  if (params.pauseStrategy === "long") {
    // Insert double spacing / pause breaks after punctuation for slow, comforting pacing
    return text.replace(/([\.!?])\s+/g, "$1  ... ");
  }
  if (params.pauseStrategy === "subtle") {
    return text.replace(/([\.!?])\s+/g, "$1  ");
  }
  return text;
}
