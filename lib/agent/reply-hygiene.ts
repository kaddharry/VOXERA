/**
 * Keeps the model's *thinking* out of the caller's ears.
 *
 * Reasoning-capable models (Qwen, gpt-oss, ...) sometimes write their plan
 * into the visible message instead of the hidden reasoning field — live-
 * reproduced on a Gnani/Hindi test call, where the agent actually SPOKE
 * "The caller is confused and hasn't provided identification info yet. I need
 * to repeat my previous question more simply ... The policy says shorter
 * turns ...". Nothing downstream can un-speak a streamed clause, so this is
 * applied per clause BEFORE it is emitted (isReasoningClause) and again on the
 * whole text (stripReasoningLeak) for the non-streaming/trace path.
 *
 * Deliberately conservative: every pattern describes the *conversation from
 * the outside* (the caller/user/patient, the policy, the persona, the rules,
 * "my response should ...") — things a person on a phone call never says
 * about the person they are talking to. Ordinary first-person speech
 * ("I need to ask you something", "let me check") is left alone.
 */

const THINK_BLOCK_RE = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi;
const THINK_OPEN_RE = /<think(?:ing)?>[\s\S]*$/gi;
const THINK_CLOSE_RE = /^[\s\S]*?<\/think(?:ing)?>/i;
const STRAY_THINK_TAG_RE = /<\/?think(?:ing)?>/gi;

/** Third-person narration of the call ("The caller is confused", "User wants..."). */
const NARRATES_CALLER_RE =
  /^\s*(?:okay,?\s+|ok,?\s+|so,?\s+|now,?\s+|hmm,?\s+|alright,?\s+)?(?:the|this)\s+(?:caller|user|patient|customer|person|speaker|human)(?:'s)?\b/i;

/** Planning / meta-commentary about how to answer. */
const PLANNING_RE = new RegExp(
  [
    // "I need to respond / repeat my previous question / match their register ..."
    String.raw`\b(?:i|we)\s+(?:need|should|must|will|'ll|want|have|ought)\s+to\s+(?:respond|reply|repeat\s+(?:my|the|that|what)|rephrase|match|follow|keep\s+(?:it|my|the|sentences|this)|use\s+(?:the|a)\s+(?:persona|tone|register|policy)|stay\s+in|stick\s+to|avoid\s+(?:using|saying)|sound|acknowledge\s+(?:the|their)|consider|think\s+about|figure\s+out|check\s+(?:the|my)\s+(?:policy|rules|instructions|context))\b`,
    // "...clarify the caller's identity", "keep it short in the same language"
    String.raw`\b(?:the|this)\s+(?:caller|user)(?:'s)?\b`,
    String.raw`\b(?:i|we)\s+(?:should|must|need\s+to|have\s+to)\s+(?:keep\s+(?:it|this|my)|respond|reply|answer\s+in|stay|match|follow|clarify)\b`,
    String.raw`\bin\s+the\s+same\s+language\b`,
    String.raw`\b(?:my|the)\s+(?:response|reply|answer|turn)\s+(?:should|must|needs?\s+to|will|has\s+to)\b`,
    String.raw`\bthe\s+(?:policy|persona|emotion|system\s+prompt|instructions?|core\s+rules|stm|evidence|current\s+turn|language\s+rule)\s+(?:block\s+)?(?:says?|states?|requires?|tells?|indicates?|suggests?|specif(?:y|ies)|wants?|is)\b`,
    String.raw`\b(?:per|according\s+to|following|as\s+per)\s+(?:the\s+)?(?:policy|persona|rules?|instructions?|system\s+prompt)\b`,
    String.raw`\b(?:system\s+prompt|my\s+instructions|core\s+rules|persona\s+block|emotion\s+block|stm\s+block|policy\s+directive)s?\b`,
    String.raw`\bmatch(?:ing)?\s+(?:their|the\s+caller's|the\s+user's)\s+(?:register|language|tone|style)\b`,
    String.raw`\b(?:let\s+me\s+think|thinking\s+process|chain\s+of\s+thought|step\s+by\s+step\s+plan)\b`,
    String.raw`^\s*(?:draft|final\s+(?:answer|reply|response)|response|reply|output|analysis|reasoning|thought|plan|note)\s*[:\-–]`,
    String.raw`^\s*\*{0,2}(?:draft|final\s+(?:answer|reply|response)|analysis|reasoning|thinking)\*{0,2}\s*[:\-–]?\s*$`,
  ].join("|"),
  "i",
);

/** True when a single clause/sentence is the model talking to itself. */
export function isReasoningClause(clause: string): boolean {
  const text = clause.trim();
  if (!text) return false;
  if (/<\/?think(?:ing)?>/i.test(text)) return true;
  return NARRATES_CALLER_RE.test(text) || PLANNING_RE.test(text);
}

/** `"Haan, maafi chahiye."` -> `Haan, maafi chahiye.` (the model often quotes its drafted line). */
export function stripWrappingQuotes(clause: string): string {
  let t = clause.trim();
  t = t.replace(/^\s*(?:draft|final\s+(?:answer|reply|response)|response|reply|output)\s*[:\-–]\s*/i, "");
  t = t.replace(/^["“”«»]+\s*/, "").replace(/\s*["“”«»]+$/, "");
  return t.trim();
}

/** Splits into sentences, keeping the terminator (handles the Devanagari danda). */
function splitSentences(text: string): string[] {
  return text.match(/[^.!?।॥\n]+(?:[.!?।॥]+["”')\]]?|\n|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

/**
 * Whole-text pass. Removes <think> blocks, then drops reasoning sentences.
 * If the model wrote its plan and THEN a quoted final line, the quoted line is
 * what the caller should hear — keep only that.
 */
export function stripReasoningLeak(text: string): string {
  let t = text.replace(THINK_BLOCK_RE, " ");
  // Dangling close tag (the opening one was swallowed upstream): everything before it is thinking.
  if (/<\/think(?:ing)?>/i.test(t)) t = t.replace(THINK_CLOSE_RE, " ");
  t = t.replace(THINK_OPEN_RE, " ").replace(STRAY_THINK_TAG_RE, " ");

  const sentences = splitSentences(t);
  const meta = sentences.filter(isReasoningClause);
  if (meta.length === 0) return t.trim();

  // Plan followed by a quoted answer: prefer the last quoted span.
  const quoted = [...t.matchAll(/["“«]([^"”»]{6,}?)["”»]/g)].map((m) => m[1].trim());
  const lastQuoted = quoted[quoted.length - 1];
  if (lastQuoted && !isReasoningClause(lastQuoted)) return lastQuoted;

  const kept = sentences.filter((s) => !isReasoningClause(s)).map(stripWrappingQuotes).filter(Boolean);
  return kept.join(" ").trim();
}

/** Unicode ranges of the Indic scripts the agent speaks, keyed by the first word of
 * detectCallerLanguage()'s label ("Bengali (Bengali script)" -> "Bengali"). */
const SCRIPT_RANGES: Record<string, RegExp> = {
  // Hindi/Marathi (Devanagari) are deliberately absent: Gnani's auto-language STT transcribes
  // short Gujarati/Punjabi greetings into Devanagari, so a Devanagari transcript does not prove
  // the caller speaks Hindi, and a non-Devanagari reply to it is not wrong.
  Bengali: /[ঀ-৿]/g,
  Gurmukhi: /[਀-੿]/g,
  Punjabi: /[਀-੿]/g,
  Gujarati: /[઀-૿]/g,
  Odia: /[଀-୿]/g,
  Tamil: /[஀-௿]/g,
  Telugu: /[ఀ-౿]/g,
  Kannada: /[ಀ-೿]/g,
  Malayalam: /[ഀ-ൿ]/g,
};
const ALL_INDIC_RE = /[\u0900-\u0963\u0966-\u0D7F]/g; // danda excluded (shared across scripts)

/** Words in scripts the agent never speaks (live-observed: a Korean "많이" inside a Gujarati reply). */
const FOREIGN_SCRIPT_TOKEN_RE =
  /\S*[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯Ѐ-ӿ฀-๿]\S*/g;
export function stripForeignScript(text: string): string {
  return text.replace(FOREIGN_SCRIPT_TOKEN_RE, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * True when the clause is written in a DIFFERENT Indic script than the caller's
 * (live-observed: a Bengali caller answered in Devanagari Hindi). Only fires for
 * an Indic caller language and a clause that actually contains Indic letters, so
 * English/Hinglish turns and number-only clauses are never flagged.
 */
export function isWrongIndicScript(clause: string, callerLanguage: string | undefined): boolean {
  const expected = callerLanguage ? SCRIPT_RANGES[callerLanguage] : undefined;
  if (!expected) return false;
  const indic = clause.match(ALL_INDIC_RE)?.length ?? 0;
  if (indic < 3) return false;
  const inExpected = clause.match(expected)?.length ?? 0;
  return inExpected < indic / 2;
}

// Lookahead: not followed by a Devanagari letter. The danda (U+0964/5) is excluded from the
// range because it ends sentences in every Indic script and is not part of a word.
const NOT_DEVANAGARI = String.raw`(?![ऀ-ॣ०-ॿ])`;
const FEMALE_FORMS: [RegExp, string][] = [
  [new RegExp(String.raw`रहा हूँ${NOT_DEVANAGARI}`, "g"), "रही हूँ"],
  [new RegExp(String.raw`सकता हूँ${NOT_DEVANAGARI}`, "g"), "सकती हूँ"],
  [new RegExp(String.raw`चाहता हूँ${NOT_DEVANAGARI}`, "g"), "चाहती हूँ"],
  [new RegExp(String.raw`समझ गया${NOT_DEVANAGARI}`, "g"), "समझ गई"],
  [new RegExp(String.raw`([ूऊ])ँगा${NOT_DEVANAGARI}`, "g"), "$1ँगी"],
];
const MALE_FORMS: [RegExp, string][] = [
  [new RegExp(String.raw`रही हूँ${NOT_DEVANAGARI}`, "g"), "रहा हूँ"],
  [new RegExp(String.raw`सकती हूँ${NOT_DEVANAGARI}`, "g"), "सकता हूँ"],
  [new RegExp(String.raw`चाहती हूँ${NOT_DEVANAGARI}`, "g"), "चाहता हूँ"],
  [new RegExp(String.raw`समझ गई${NOT_DEVANAGARI}`, "g"), "समझ गया"],
  [new RegExp(String.raw`([ूऊ])ँगी${NOT_DEVANAGARI}`, "g"), "$1ँगा"],
];
/**
 * Hindi first-person verbs carry the speaker's gender, and the voice has one (live-observed:
 * a female voice said "समझ गया"). Only unambiguous first-person patterns are rewritten, so
 * addressing the caller ("आप जा रहे हैं") is never touched.
 */
export function matchSpeakerGender(text: string, gender: "female" | "male" | undefined): string {
  if (!gender || !/[ऀ-ॿ]/.test(text)) return text;
  return (gender === "female" ? FEMALE_FORMS : MALE_FORMS).reduce((t, [re, to]) => t.replace(re, to), text);
}
