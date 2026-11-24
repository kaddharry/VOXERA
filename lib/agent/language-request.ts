/** Detects an explicit "please speak English / Hindi" request in a transcript
 * (Latin or Devanagari). Used to pin the call language for the rest of the
 * call, because STT in auto mode can write English speech in another Indic
 * script ("I am not feeling good" came back as Gujarati letters), which then
 * made the agent switch to Gujarati against the caller's wishes. */
export type RequestedLanguage = "english" | "hindi";

const ENGLISH_WORD = /(english|इंग्लिश|इंग्लीश|अंग्रेज़ी|अंग्रेजी|angrezi|ਅੰਗਰੇਜ਼ੀ|અંગ્રેજી)/i;
const HINDI_WORD = /(\bhindi\b|हिंदी|हिन्दी|ਹਿੰਦੀ|હિન્દી)/i;
const ASK_WORD = /(speak|talk|switch|reply|answer|continue|can you|could you|please|बात|बोल|बोलो|बोलिए|कर सकत|कीजिए|करो|में|मे\b|mein|\bme\b|bolo|baat|कह)/i;

export function detectLanguageRequest(text: string): RequestedLanguage | null {
  if (!ASK_WORD.test(text)) return null;
  if (ENGLISH_WORD.test(text)) return "english";
  if (HINDI_WORD.test(text)) return "hindi";
  return null;
}

/** Safety net: common English words as STT spells them in Devanagari / Gujarati /
 * Gurmukhi. If most of a turn is these, the caller spoke English. */
const TRANSLIT_ENGLISH = new Set([
  "आई", "आय", "हैव", "हेव", "अ", "ए", "एन", "द", "दी", "टू", "टु", "कैन", "कैन", "वांट", "वाँट", "एम", "नोट", "इज़", "इज", "इट", "यस", "येस", "नो", "ओके", "सो", "बट", "एंड", "एण्ड", "विथ", "फॉर", "माय", "यू", "योर", "प्लीज", "प्लीज़", "बुक", "अपॉइंटमेंट", "डॉक्टर", "पेन", "टूथ", "टुमारो", "टुडे", "थैंक", "थैंक्स", "हेलो", "हाय", "फीलिंग", "गुड", "बैड", "बेसिकली", "वुड", "लाइक", "टाइम", "मी", "इन", "ऑन", "एट", "वी", "दिस", "दैट", "हाउ", "व्हाट", "वॉट", "व्हेन", "आर", "वाज", "बी", "दो", "डू", "डोंट", "नाउ", "टुमॉरो", "ऐक", "ऑल", "राइट", "सॉरी", "वेल",
  "આઈ", "એમ", "નોટ", "ફીલિંગ", "ગુડ", "હેવ", "ટૂ", "ટુ", "બુક", "એપોઇન્ટમેન્ટ", "ડૉક્ટર", "ડોક્ટર", "પેઇન", "યસ", "નો", "ઓકે", "પ્લીઝ", "થેંક્સ", "કેન", "વોન્ટ",
  "ਆਈ", "ਹੈਵ", "ਅ", "ਟੂ", "ਬੁੱਕ", "ਐਪੋਇੰਟਮੈਂਟ", "ਡਾਕਟਰ", "ਪੇਨ", "ਯੈਸ", "ਨੋ", "ਓਕੇ", "ਪਲੀਜ਼", "ਕੈਨ", "ਵਾਂਟ",
]);

export function looksLikeTransliteratedEnglish(text: string): boolean {
  const tokens = text.split(/[\s,.!?।॥]+/).filter(Boolean);
  if (tokens.length < 3) return false;
  const hits = tokens.filter((t) => TRANSLIT_ENGLISH.has(t)).length;
  return hits / tokens.length >= 0.6;
}
