/** Detects an explicit "please speak English / Hindi" request in a transcript
 * (Latin or Devanagari). Used to pin the call language for the rest of the
 * call, because STT in auto mode can write English speech in another Indic
 * script ("I am not feeling good" came back as Gujarati letters), which then
 * made the agent switch to Gujarati against the caller's wishes. */
export type RequestedLanguage =
  | "english" | "hindi" | "marathi" | "punjabi" | "gujarati" | "bengali"
  | "tamil" | "telugu" | "kannada" | "malayalam" | "odia";

const LANGUAGE_WORDS: Array<[RequestedLanguage, RegExp]> = [
  ["english", /(english|इंग्लिश|इंग्लीश|अंग्रेज़ी|अंग्रेजी|angrezi|ਅੰਗਰੇਜ਼ੀ|અંગ્રેજી)/gi],
  ["hindi", /(\bhindi\b|हिंदी|हिन्दी|ਹਿੰਦੀ|હિન્દી)/gi],
  ["marathi", /(\bmarathi\b|मराठी)/gi],
  ["punjabi", /(\bpunjabi\b|पंजाबी|ਪੰਜਾਬੀ)/gi],
  ["gujarati", /(\bgujarati\b|गुजराती|ગુજરાતી)/gi],
  ["bengali", /(\bbengali\b|\bbangla\b|बंगाली|বাংলা)/gi],
  ["tamil", /(\btamil\b|तमिल|தமிழ்)/gi],
  ["telugu", /(\btelugu\b|तेलुगु|తెలుగు)/gi],
  ["kannada", /(\bkannada\b|कन्नड़|कन्नड|ಕನ್ನಡ)/gi],
  ["malayalam", /(\bmalayalam\b|मलयालम|മലയാളം)/gi],
  ["odia", /(\bodia\b|\boriya\b|ओड़िया|ओडिया|ଓଡ଼ିଆ)/gi],
];
const ASK_WORD = /(speak|talk|switch|reply|answer|continue|can you|could you|please|बात|बोल|बोलो|बोलिए|कर सकत|कीजिए|करो|में|मे\b|mein|\bme\b|bolo|baat|कह)/i;
/** "I am Punjabi" / "मैं पंजाबी हूँ" is about the caller, not a request — unless they also say speak/talk/bol. */
const IDENTITY = /(\bi am\b|\bi'm\b|\bhoon\b|\bhu\b|हूँ|हूं)/i;
const STRONG_ASK = /(speak|talk|switch|reply|answer|बात|बोल|bolo|bol\b|baat)/i;
/** "Hindi nahi, English mein bolo" / "not in Hindi" — a language right before or after a no is not the one wanted. */
const NEG_AFTER = /^\s*(?:(?:mein|me|में|मे)\s+)?(nahi|nahin|नहीं|नही|मत|ना\b|not\b|no\b)/i;
const NEG_BEFORE = /(\bnot|\bno|\bnot in|नहीं|मत)\s*$/i;

/** The language the caller explicitly asks the agent to use in this turn, or null.
 * When several are named ("Hindi nahi, English mein bolo"), the one not negated
 * and mentioned last wins. */
export function detectLanguageRequest(text: string): RequestedLanguage | null {
  if (!ASK_WORD.test(text)) return null;
  if (IDENTITY.test(text) && !STRONG_ASK.test(text)) return null;
  const mentions: Array<{ lang: RequestedLanguage; at: number }> = [];
  for (const [lang, re] of LANGUAGE_WORDS) {
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      const after = text.slice(at + m[0].length, at + m[0].length + 12);
      const before = text.slice(Math.max(0, at - 8), at);
      if (NEG_AFTER.test(after) || NEG_BEFORE.test(before)) continue;
      mentions.push({ lang, at });
    }
  }
  if (mentions.length === 0) return null;
  return mentions.sort((a, b) => a.at - b.at)[mentions.length - 1].lang;
}

/** Safety net: common English words as STT spells them in Devanagari / Gujarati /
 * Gurmukhi. If most of a turn is these, the caller spoke English. */
export const TRANSLIT_ENGLISH_WORDS = new Set([
  "आई", "आय", "हैव", "हेव", "अ", "ए", "एन", "द", "दी", "टू", "टु", "कैन", "कैन", "वांट", "वाँट", "एम", "नोट", "इज़", "इज", "इट", "यस", "येस", "नो", "ओके", "सो", "बट", "एंड", "एण्ड", "विथ", "फॉर", "माय", "यू", "योर", "प्लीज", "प्लीज़", "बुक", "अपॉइंटमेंट", "डॉक्टर", "पेन", "टूथ", "टुमारो", "टुडे", "थैंक", "थैंक्स", "हेलो", "हाय", "फीलिंग", "गुड", "बैड", "बेसिकली", "वुड", "लाइक", "टाइम", "मी", "इन", "ऑन", "एट", "वी", "दिस", "दैट", "हाउ", "व्हाट", "वॉट", "व्हेन", "आर", "वाज", "बी", "दो", "डू", "डोंट", "नाउ", "टुमॉरो", "ऐक", "ऑल", "राइट", "सॉरी", "वेल",
  "આઈ", "એમ", "નોટ", "ફીલિંગ", "ગુડ", "હેવ", "ટૂ", "ટુ", "બુક", "એપોઇન્ટમેન્ટ", "ડૉક્ટર", "ડોક્ટર", "પેઇન", "યસ", "નો", "ઓકે", "પ્લીઝ", "થેંક્સ", "કેન", "વોન્ટ",
  "ਆਈ", "ਹੈਵ", "ਅ", "ਟੂ", "ਬੁੱਕ", "ਐਪੋਇੰਟਮੈਂਟ", "ਡਾਕਟਰ", "ਪੇਨ", "ਯੈਸ", "ਨੋ", "ਓਕੇ", "ਪਲੀਜ਼", "ਕੈਨ", "ਵਾਂਟ",
]);

export function looksLikeTransliteratedEnglish(text: string): boolean {
  const tokens = text.split(/[\s,.!?।॥]+/).filter(Boolean);
  if (tokens.length < 3) return false;
  const hits = tokens.filter((t) => TRANSLIT_ENGLISH_WORDS.has(t)).length;
  return hits / tokens.length >= 0.6;
}
