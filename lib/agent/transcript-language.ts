/**
 * One language per utterance.
 *
 * Gnani's auto-detect + codemix STT sometimes splits a single English sentence across scripts:
 * "yes I am Hardik" comes back as "yes आई एम हार्दिक" ("yes" in English, the rest as English
 * words spelled in Devanagari). The agent then reads it as Hindi and answers in Hindi.
 *
 * `analyzeTranscriptLanguage` classifies an utterance by script and word lists (instant, no
 * network). `normalizeTranscript` fixes the one broken case — English spoken, written in mixed
 * scripts — by asking the small fast model to rewrite it in plain English. It only spends that
 * call when the utterance is actually broken, so normal turns pay nothing.
 */
import { generateReply } from "./llm";
import { looksLikeTransliteratedEnglish, TRANSLIT_ENGLISH_WORDS } from "./language-request";

export type UtteranceLanguage = "english" | "hindi" | "hinglish" | "punjabi" | "other-indic" | "unknown";

const DEVANAGARI = /[ऀ-ॿ]/;
const GURMUKHI = /[਀-੿]/;
const OTHER_INDIC = /[ঀ-৿઀-૿଀-௿ఀ-෿]/; // Bengali, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam, Sinhala
const LATIN_WORD = /^[A-Za-z][A-Za-z'’-]*$/;

/** Common Hindi/Punjabi function words in Roman letters. A sentence with several of these is Hinglish, not English. */
const ROMAN_HINDI = new Set([
  "hai", "hain", "hoon", "hu", "ho", "tha", "thi", "the", "nahi", "nahin", "mera", "meri", "mere", "mujhe", "main", "mein", "aap", "aapka",
  "aapki", "kya", "kyun", "kaise", "kab", "kahan", "kal", "aaj", "abhi", "bahut", "bohot", "accha", "achha", "theek", "thik", "haan", "ji",
  "karna", "karo", "kar", "karta", "karti", "raha", "rahi", "rahe", "chahiye", "chahta", "chahti", "se", "ko", "ka", "ki", "ke", "par", "aur",
  "toh", "to", "bhi", "lekin", "magar", "dard", "dawai", "dawa", "doctor", "sahab", "bhai", "didi", "namaste", "dhanyavaad", "shukriya",
  "tusi", "tuhada", "tuhadi", "mainu", "menu", "ki", "haanji", "nahi", "kiddan", "chandi", "sat", "sri", "akal",
]);

function tokens(text: string): string[] {
  return text.split(/[\s,.!?।॥;:"“”()]+/).filter(Boolean);
}

/** Cheap, offline classification of what language an utterance is written in. */
export function analyzeTranscriptLanguage(text: string): UtteranceLanguage {
  const toks = tokens(text);
  if (toks.length === 0) return "unknown";
  const deva = toks.filter((t) => DEVANAGARI.test(t)).length;
  const gurm = toks.filter((t) => GURMUKHI.test(t)).length;
  const other = toks.filter((t) => OTHER_INDIC.test(t)).length;
  const latin = toks.filter((t) => LATIN_WORD.test(t)).length;
  if (gurm > 0 && gurm >= deva) return "punjabi";
  if (deva > 0) return looksLikeTransliteratedEnglish(text) ? "english" : "hindi";
  if (other > 0) return looksLikeTransliteratedEnglish(text) ? "english" : "other-indic";
  if (latin === 0) return "unknown";
  const romanHindi = toks.filter((t) => ROMAN_HINDI.has(t.toLowerCase())).length;
  // Short English like "yes I am Hardik" has no Hindi marker words; "doctor"/"to"/"the" alone don't make Hinglish.
  const strong = toks.filter((t) => ROMAN_HINDI.has(t.toLowerCase()) && !["doctor", "to", "the", "ho", "se", "par", "ki", "ka", "ko", "ke", "hu", "sat", "sri"].includes(t.toLowerCase())).length;
  if (strong >= 2 || (strong >= 1 && romanHindi / toks.length >= 0.3)) return "hinglish";
  return "english";
}

/**
 * True when English was spoken but the transcript is split across scripts, e.g. "yes आई एम हार्दिक":
 * Latin words next to Indic-script words that are (mostly) English spelled phonetically.
 */
export function isMixedScriptEnglish(text: string): boolean {
  const toks = tokens(text);
  const indic = toks.filter((t) => DEVANAGARI.test(t) || GURMUKHI.test(t) || OTHER_INDIC.test(t));
  const latin = toks.filter((t) => LATIN_WORD.test(t));
  if (indic.length === 0) return false;
  if (looksLikeTransliteratedEnglish(text)) return true; // all-Indic-script English
  if (latin.length === 0) return false;
  const translit = indic.filter((t) => TRANSLIT_ENGLISH_WORDS.has(t)).length;
  // A Hindi sentence with one English word ("मेरा appointment कल है") has almost no transliterated-English words; the broken case does.
  return translit >= 1 && translit / indic.length >= 0.5 && indic.length <= 8;
}

const SYSTEM = `A speech-to-text system wrote an English sentence partly in Indian-script letters (English words spelled phonetically). Rewrite the WHOLE sentence in normal English using only Latin letters. Spell personal names the usual way (e.g. हार्दिक -> Hardik). Keep numbers and meaning exactly. Output only the sentence, nothing else.`;

const cache = new Map<string, string>();

/**
 * Returns the transcript in ONE language/script. Only English-split-across-scripts is rewritten;
 * everything else (Hindi, Hinglish, Punjabi, plain English) is returned unchanged and instantly.
 * Never throws: on timeout or any failure the original text is returned.
 */
export async function normalizeTranscript(text: string, opts: { timeoutMs?: number; clientId?: string } = {}): Promise<string> {
  if (!isMixedScriptEnglish(text)) return text;
  const hit = cache.get(text);
  if (hit) return hit;
  try {
    const run = generateReply({
      system: SYSTEM,
      user: text.slice(0, 400),
      clientId: opts.clientId ?? "transcript-normalize",
      useTools: false,
      raw: true,
      fastModel: true,
      maxOutputTokens: 80,
    });
    const res = await Promise.race([run, new Promise<null>((r) => setTimeout(() => r(null), opts.timeoutMs ?? 1500))]);
    const out = res?.text?.trim().replace(/^["“]|["”]$/g, "");
    // Accept only a clean Latin-script rewrite of similar length.
    if (out && !/[ऀ-෿]/.test(out) && out.length >= 2 && out.length <= text.length * 3 + 20) {
      if (cache.size > 300) cache.clear();
      cache.set(text, out);
      return out;
    }
  } catch {
    /* keep original */
  }
  return text;
}
