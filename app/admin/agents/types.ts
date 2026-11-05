export interface Agent {
  id: string;
  tenant_id: string;
  name: string;
  type: string | null;
  status: string;
  description: string | null;
  system_prompt: string | null;
  greeting: string | null;
  voice_persona: string | null;
  /** NULL = inherit the tenant's Settings default (app/admin/settings). */
  speech_provider: "deepgram" | "gnani" | null;
  language: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeneratedAgentDraft {
  name: string;
  description: string;
  system_prompt: string;
  greeting: string;
}

export interface Draft {
  name: string;
  description: string;
  system_prompt: string;
  greeting: string;
  voice_persona: string;
  /** null = inherit the tenant's Settings default. */
  speech_provider: "deepgram" | "gnani" | null;
  language: string | null;
}

export const BLANK_DRAFT: Draft = {
  name: "",
  description: "",
  system_prompt: "",
  greeting: "",
  voice_persona: "female-friendly",
  speech_provider: null,
  language: null,
};

export const VOICE_PERSONAS = [
  { id: "female-friendly", label: "Female · Friendly" },
  { id: "male-formal", label: "Male · Formal" },
  { id: "female-formal", label: "Female · Formal" },
  { id: "male-friendly", label: "Male · Friendly" },
];

/** Gnani/Vachana's supported languages (lib/tts/gnani.ts's GnaniLanguage
 * type) with human labels for the Agent Builder / Settings pickers. Deepgram
 * stays English-only and has no language picker of its own — see the plan's
 * decision in /Users/vikasverma/.claude/plans/deep-beaming-hennessy.md. */
export const GNANI_LANGUAGES: { id: string; label: string }[] = [
  { id: "hi-en", label: "Hinglish (Hindi + English, code-mixed)" },
  { id: "hi-IN", label: "Hindi" },
  { id: "en-IN", label: "English (India)" },
  { id: "ta-IN", label: "Tamil" },
  { id: "te-IN", label: "Telugu" },
  { id: "kn-IN", label: "Kannada" },
  { id: "ml-IN", label: "Malayalam" },
  { id: "mr-IN", label: "Marathi" },
  { id: "pa-IN", label: "Punjabi" },
  { id: "bn-IN", label: "Bengali" },
  { id: "gu-IN", label: "Gujarati" },
  { id: "auto", label: "Auto-detect" },
];
