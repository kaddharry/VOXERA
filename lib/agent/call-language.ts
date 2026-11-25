import { detectLanguageRequest, looksLikeTransliteratedEnglish, type RequestedLanguage } from "./language-request";

/** The language the agent replies in for the whole call.
 *
 * Before: the prompt told the model to follow the language of the CURRENT turn,
 * so one English sentence ("ok, I understand") in a Hindi call flipped the
 * agent to English, and the next Hindi turn flipped it back.
 *
 * Now the call language is decided from the caller's own turns:
 *   1. The caller's first real sentence (3+ words) sets it.
 *   2. An explicit request ("English mein baat karo", "can you speak Hindi")
 *      switches it at once, for the rest of the call.
 *   3. Without asking, it switches only when the caller says two real
 *      sentences in a row in another language. Short bits ("ok", "thank you",
 *      "haan ji") never switch it.
 * Pure function of the turn history, so it works the same for phone calls,
 * the browser test drawer and the /api/turn test page. */

export type CallLanguage = RequestedLanguage;

export interface CallLanguageState {
  language: CallLanguage;
  /** How it was decided: the caller asked, it is their first language, or they kept speaking a new one. */
  reason: "asked" | "first" | "switched";
  /** For Hindi: which script the caller writes it in (STT-dependent), so the reply matches. */
  script: "devanagari" | "roman" | "native";
}

const SWITCH_AFTER_TURNS = 2;
const MIN_WORDS = 3;

const SCRIPT_LANG: Array<[RegExp, CallLanguage]> = [
  [/[஀-௿]/, "tamil"],
  [/[ఀ-౿]/, "telugu"],
  [/[ಀ-೿]/, "kannada"],
  [/[ഀ-ൿ]/, "malayalam"],
  [/[ঀ-৿]/, "bengali"],
  [/[઀-૿]/, "gujarati"],
  [/[਀-੿]/, "punjabi"],
  [/[଀-୿]/, "odia"],
];
const DEVANAGARI = /[ऀ-ॣ०-ॿ]/;
const MARATHI_WORDS = /(^|\s)(मी|आहे|आहेत|काय|तुम्ही|करू|नाही|थोडं|होतंय|दुखतंय|मला|तुमचा|आपलं)(\s|[,.?!।]|$)/;
const ROMAN_HINDI_WORDS = /\b(aap|aapka|aapki|hai|hain|hoon|kya|kaise|karna|bataiye|batao|theek|nahi|nahin|haan|mujhe|chahiye|dobara|kal|baje|dawai|samajh|bolo|raha|rahi|ho|mera|meri|dard|bahut|kuch|abhi)\b/gi;

export interface TurnLanguage {
  language: CallLanguage;
  script: CallLanguageState["script"];
}

/** Language of one caller turn, by script and (for Latin letters) common Hindi words. */
export function turnLanguage(text: string): TurnLanguage {
  if (looksLikeTransliteratedEnglish(text)) return { language: "english", script: "roman" };
  for (const [re, lang] of SCRIPT_LANG) if (re.test(text)) return { language: lang, script: "native" };
  if (DEVANAGARI.test(text)) {
    return MARATHI_WORDS.test(text) ? { language: "marathi", script: "native" } : { language: "hindi", script: "devanagari" };
  }
  // Roman letters: Hinglish if a fair share of words are everyday Hindi words.
  const words = text.split(/\s+/).filter(Boolean);
  const hindiHits = (text.match(ROMAN_HINDI_WORDS) ?? []).length;
  if (hindiHits >= 2 || (hindiHits === 1 && words.length <= 4)) return { language: "hindi", script: "roman" };
  return { language: "english", script: "roman" };
}

function wordCount(text: string): number {
  return text.split(/[\s,.!?।॥]+/).filter(Boolean).length;
}

/** Replays the caller's turns (oldest first, current turn last) and returns the call language, or null if no real sentence yet. */
export function resolveCallLanguage(callerTurns: string[]): CallLanguageState | null {
  let state = null as CallLanguageState | null;
  let streak = null as { language: CallLanguage; count: number; script: CallLanguageState["script"] } | null;
  for (const text of callerTurns) {
    if (!text?.trim()) continue;
    const asked = detectLanguageRequest(text);
    if (asked) {
      const seen = turnLanguage(text);
      state = { language: asked, reason: "asked", script: scriptFor(asked, seen.language === asked ? seen.script : state?.script) };
      streak = null;
      continue;
    }
    if (wordCount(text) < MIN_WORDS) continue;
    const seen = turnLanguage(text);
    if (!state) {
      state = { language: seen.language, reason: "first", script: seen.script };
      continue;
    }
    if (seen.language === state.language) {
      // Same language: keep it, but follow the caller's script (Devanagari vs Roman Hindi).
      state = { ...state, script: seen.script };
      streak = null;
      continue;
    }
    streak = streak && streak.language === seen.language
      ? { ...streak, count: streak.count + 1, script: seen.script }
      : { language: seen.language, count: 1, script: seen.script };
    if (streak.count >= SWITCH_AFTER_TURNS) {
      state = { language: streak.language, reason: "switched", script: streak.script };
      streak = null;
    }
  }
  return state;
}

function scriptFor(lang: CallLanguage, known?: CallLanguageState["script"]): CallLanguageState["script"] {
  if (lang === "english") return "roman";
  if (lang === "hindi") return known === "roman" ? "roman" : "devanagari";
  return "native";
}

const NAMES: Record<CallLanguage, string> = {
  english: "English", hindi: "Hindi", marathi: "Marathi", punjabi: "Punjabi", gujarati: "Gujarati",
  bengali: "Bengali", tamil: "Tamil", telugu: "Telugu", kannada: "Kannada", malayalam: "Malayalam", odia: "Odia",
};
const SCRIPTS: Record<CallLanguage, string> = {
  english: "Latin letters", hindi: "Devanagari", marathi: "Devanagari", punjabi: "Gurmukhi script", gujarati: "Gujarati script",
  bengali: "Bengali script", tamil: "Tamil script", telugu: "Telugu script", kannada: "Kannada script", malayalam: "Malayalam script", odia: "Odia script",
};

/** The prompt line placed right above the caller's words. Starts with "CALLER LANGUAGE THIS TURN: <Name>"
 * because lib/agent/llm.ts reads that name to catch a reply in the wrong script. */
export function callLanguageLine(state: CallLanguageState): string {
  const why = state.reason === "asked" ? "the caller asked for it" : state.reason === "switched" ? "the caller switched to it" : "the language the caller chose";
  const keep = "Keep it even if this turn has a few words or a short phrase in another language.";
  if (state.language === "english") {
    return `CALLER LANGUAGE THIS TURN: English — call language (${why}). Reply in English only, in Latin letters, even if the transcript below shows another script (that is STT error). ${keep}`;
  }
  if (state.language === "hindi" && state.script === "roman") {
    return `CALLER LANGUAGE THIS TURN: Hinglish (Roman letters) — call language is Hindi (${why}). Reply in natural Roman-letter Hinglish. ${keep}`;
  }
  return `CALLER LANGUAGE THIS TURN: ${NAMES[state.language]} (${SCRIPTS[state.language]}) — call language (${why}). Reply in ${NAMES[state.language]}, in ${SCRIPTS[state.language]}. ${keep}`;
}
