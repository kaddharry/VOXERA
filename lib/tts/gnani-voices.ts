import type { GnaniLanguage } from "./gnani";

export type GnaniModel = "timbre-v2.5" | "timbre-v3.0";

export interface GnaniVoice {
  /** The exact string the TTS API's "voice" field expects. */
  id: string;
  model: GnaniModel;
  gender: "female" | "male";
  /** timbre-v3.0 voices speak all 10 languages — "all" rather than one code. */
  language: GnaniLanguage | "all";
}

/**
 * Gnani's voice catalog — no list-voices API exists (confirmed against their
 * docs: https://docs.gnani.ai/api/TTS/available-voices), so this is shipped
 * statically, same reasoning as lib/deepgram/voices.ts's header comment.
 * Source: https://docs.gnani.ai/api/TTS/available-voices, fetched live.
 *
 * Timbre v3.0 (13 voices) — each speaks all 10 languages, so voice choice
 * is independent of language choice. Timbre v2.5 (42 voices) — each has ONE
 * preferred language; voices are model-specific and can't be shared between
 * models (confirmed by the TTS Realtime docs).
 */
export const GNANI_VOICES: GnaniVoice[] = [
  // Timbre v3.0 — language-agnostic
  { id: "Shivani", model: "timbre-v3.0", gender: "female", language: "all" },
  { id: "Lakshmi", model: "timbre-v3.0", gender: "female", language: "all" },
  { id: "Kalpana", model: "timbre-v3.0", gender: "female", language: "all" },
  { id: "Chetana", model: "timbre-v3.0", gender: "female", language: "all" },
  { id: "Vasudha", model: "timbre-v3.0", gender: "female", language: "all" },
  { id: "Riyaa", model: "timbre-v3.0", gender: "female", language: "all" },
  { id: "Tarika", model: "timbre-v3.0", gender: "female", language: "all" },
  { id: "Avinash", model: "timbre-v3.0", gender: "male", language: "all" },
  { id: "Shubham", model: "timbre-v3.0", gender: "male", language: "all" },
  { id: "Prakash", model: "timbre-v3.0", gender: "male", language: "all" },
  { id: "Devansh", model: "timbre-v3.0", gender: "male", language: "all" },
  { id: "Yashraj", model: "timbre-v3.0", gender: "male", language: "all" },
  { id: "Harshad", model: "timbre-v3.0", gender: "male", language: "all" },

  // Timbre v2.5 — one preferred language each
  { id: "Ambuja", model: "timbre-v2.5", gender: "female", language: "hi-IN" },
  { id: "Asmita", model: "timbre-v2.5", gender: "female", language: "ta-IN" },
  { id: "Bhavna", model: "timbre-v2.5", gender: "female", language: "hi-IN" },
  { id: "Brinda", model: "timbre-v2.5", gender: "female", language: "ta-IN" },
  { id: "Chitra", model: "timbre-v2.5", gender: "female", language: "hi-IN" },
  { id: "Deepak", model: "timbre-v2.5", gender: "male", language: "hi-IN" },
  { id: "Devika", model: "timbre-v2.5", gender: "female", language: "en-IN" },
  { id: "Dhruva", model: "timbre-v2.5", gender: "male", language: "bn-IN" },
  { id: "Falak", model: "timbre-v2.5", gender: "female", language: "gu-IN" },
  { id: "Girish", model: "timbre-v2.5", gender: "male", language: "en-IN" },
  { id: "Hemraj", model: "timbre-v2.5", gender: "male", language: "hi-IN" },
  { id: "Ishaan", model: "timbre-v2.5", gender: "male", language: "mr-IN" },
  { id: "Jalaj", model: "timbre-v2.5", gender: "male", language: "hi-IN" },
  { id: "Jwala", model: "timbre-v2.5", gender: "female", language: "hi-IN" },
  { id: "Kaveri", model: "timbre-v2.5", gender: "female", language: "en-IN" },
  { id: "Kavin", model: "timbre-v2.5", gender: "male", language: "kn-IN" },
  { id: "Kirra", model: "timbre-v2.5", gender: "female", language: "bn-IN" },
  { id: "Lavanya", model: "timbre-v2.5", gender: "female", language: "te-IN" },
  { id: "Lehara", model: "timbre-v2.5", gender: "female", language: "te-IN" },
  { id: "Mehuli", model: "timbre-v2.5", gender: "female", language: "pa-IN" },
  { id: "Nalini", model: "timbre-v2.5", gender: "female", language: "hi-IN" },
  { id: "Noopur", model: "timbre-v2.5", gender: "female", language: "ta-IN" },
  { id: "Omkar", model: "timbre-v2.5", gender: "male", language: "hi-IN" },
  { id: "Poorvi", model: "timbre-v2.5", gender: "female", language: "hi-en" },
  { id: "Pranav", model: "timbre-v2.5", gender: "male", language: "en-IN" },
  { id: "Reshma", model: "timbre-v2.5", gender: "female", language: "ml-IN" },
  { id: "Riyaan", model: "timbre-v2.5", gender: "male", language: "ml-IN" },
  { id: "Roopesh", model: "timbre-v2.5", gender: "male", language: "hi-IN" },
  { id: "Saanvi", model: "timbre-v2.5", gender: "female", language: "kn-IN" },
  { id: "Shlok", model: "timbre-v2.5", gender: "male", language: "en-IN" },
  { id: "Suhana", model: "timbre-v2.5", gender: "female", language: "te-IN" },
  { id: "Trisha", model: "timbre-v2.5", gender: "female", language: "ta-IN" },
  { id: "Trupti", model: "timbre-v2.5", gender: "female", language: "en-IN" },
  { id: "Urmila", model: "timbre-v2.5", gender: "female", language: "hi-IN" },
  { id: "Varuni", model: "timbre-v2.5", gender: "female", language: "te-IN" },
  { id: "Vedika", model: "timbre-v2.5", gender: "female", language: "ta-IN" },
  { id: "Veera", model: "timbre-v2.5", gender: "male", language: "gu-IN" },
  { id: "Vikrant", model: "timbre-v2.5", gender: "male", language: "hi-IN" },
  { id: "Yashvi", model: "timbre-v2.5", gender: "female", language: "hi-IN" },
  { id: "Yukti", model: "timbre-v2.5", gender: "female", language: "te-IN" },
  { id: "Zahira", model: "timbre-v2.5", gender: "female", language: "mr-IN" },
  { id: "Zayan", model: "timbre-v2.5", gender: "male", language: "pa-IN" },
];

export const DEFAULT_GNANI_VOICE: GnaniVoice = GNANI_VOICES.find((v) => v.id === "Nalini")!;

/** Composite persona string stored in agents.voice_persona /
 * business_settings.voice_persona when speech_provider="gnani" —
 * "gnani:<model>:<voiceId>", e.g. "gnani:timbre-v2.5:Nalini". Keeps one DB
 * column doing double duty for both providers rather than a migration. */
export function formatGnaniPersona(voice: { id: string; model: GnaniModel }): string {
  return `gnani:${voice.model}:${voice.id}`;
}

export function parseGnaniPersona(persona: string | null | undefined): GnaniVoice {
  if (persona?.startsWith("gnani:")) {
    const [, model, id] = persona.split(":");
    const match = GNANI_VOICES.find((v) => v.model === model && v.id === id);
    if (match) return match;
  }
  return DEFAULT_GNANI_VOICE;
}
