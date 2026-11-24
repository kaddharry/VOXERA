/**
 * Instant multilingual emotion rules (English, Hindi in Devanagari, Hinglish in
 * Roman letters, Punjabi in Gurmukhi and Roman). This is the no-network fast path:
 * it feeds the persona/policy for the current turn and is the fallback when the
 * small-model classifier (llm-emotion.ts) is unavailable. It only needs to be
 * right about clear cases; everything ambiguous is left to the model.
 *
 * Plain substring/regex stems are used for Indic scripts because `\b` does not
 * work for them in JavaScript.
 */
import type { EmotionLabel } from "../types";

interface Rule {
  label: EmotionLabel;
  /** Weight: how strongly a hit indicates the label. */
  w: number;
  re: RegExp;
}

const r = (label: EmotionLabel, w: number, pattern: string): Rule => ({ label, w, re: new RegExp(pattern, "iu") });

const RULES: Rule[] = [
  // ── pain (physical) ──
  r("pain", 1.0, String.raw`\b(?:pain|painful|hurts?|hurting|aching|aches?|ache|sore|cramps?|burning|stabbing|throbbing|swollen|swelling|bleeding)\b`),
  r("pain", 1.0, String.raw`\b(?:dard|dukh(?:ta|ti|ne)|dard\s*ho|sujan|chubh|jalan|dukhda)\b`),
  r("pain", 1.0, String.raw`(?:दर्द|पीड़ा|सूजन|जलन|चुभ|टीस|दुख रहा|दुखता|दुखती)`),
  r("pain", 1.0, String.raw`(?:ਦਰਦ|ਪੀੜ|ਸੋਜ|ਜਲਨ|ਚੁਭ|ਦੁਖ ਰਿਹਾ|ਦੁੱਖ ਰਿਹਾ)`),
  r("pain", 1.0, String.raw`\b(?:dard\s*(?:ho|hai|ho\s*raha|ho\s*rahi)|peed|sojan)\b`),

  // ── relief ──
  r("relief", 1.2, String.raw`\b(?:phew|what a relief|big relief|such a relief|thank god|thank goodness|finally over|weight off|load off|feeling better now|much better now)\b`),
  r("relief", 1.2, String.raw`\b(?:rahat|raahat|shukar\s*hai|shukr\s*hai|chain\s*mila|sukoon|jaan\s*mein\s*jaan|bhagwan\s*ka\s*shukar|thank god)\b`),
  r("relief", 1.2, String.raw`(?:राहत|शुक्र है|शुक्र|सुकून|चैन मिला|जान में जान|भगवान का शुक्र)`),
  r("relief", 1.2, String.raw`(?:ਰਾਹਤ|ਸ਼ੁਕਰ|ਸੁਕੂਨ|ਚੈਨ ਮਿਲਿਆ|ਜਾਨ ਵਿੱਚ ਜਾਨ)`),

  // ── gratitude ──
  r("gratitude", 1.2, String.raw`\b(?:thanks?|thank you|thankful|grateful|appreciate(?:d)?|much obliged|bless you|god bless)\b`),
  r("gratitude", 1.2, String.raw`\b(?:shukriya|shukria|dhanyavaad|dhanyawad|meherbani|mehrbani|aapka\s*ehsan|bahut\s*dhanyavaad|thanku|dhanvaad)\b`),
  r("gratitude", 1.2, String.raw`(?:धन्यवाद|शुक्रिया|मेहरबानी|एहसान|आभारी|आभार)`),
  r("gratitude", 1.2, String.raw`(?:ਧੰਨਵਾਦ|ਸ਼ੁਕਰੀਆ|ਮਿਹਰਬਾਨੀ|ਮਿਹਰਬਾਨ|ਅਹਿਸਾਨ)`),

  // ── excitement ──
  r("excitement", 1.1, String.raw`\b(?:can'?t wait|so excited|super excited|thrilled|pumped|looking forward|amazing news|fantastic)\b`),
  r("excitement", 1.1, String.raw`\b(?:bahut\s*excited|excited\s*hoon|intezaar\s*nahi\s*ho\s*raha|wait\s*nahi\s*kar\s*sakta|mazaa\s*aa\s*gaya|bahut\s*utsuk)\b`),
  r("excitement", 1.1, String.raw`(?:उत्साहित|बेसब्र|इंतज़ार नहीं हो रहा|इंतजार नहीं हो रहा|रोमांचित|बहुत एक्साइटेड)`),
  r("excitement", 1.1, String.raw`(?:ਉਤਸ਼ਾਹਿਤ|ਬੇਸਬਰ|ਇੰਤਜ਼ਾਰ ਨਹੀਂ ਹੋ ਰਿਹਾ|ਬਹੁਤ ਖੁਸ਼ ਹਾਂ ਮੈਂ ਉਡੀਕ)`),

  // ── joy ──
  r("joy", 1.0, String.raw`\b(?:happy|glad|delighted|wonderful|great news|good news|lovely|awesome|pleased|so good|love it|enjoyed)\b`),
  r("joy", 1.0, String.raw`\b(?:khush|khushi|bahut\s*accha|bahut\s*achha|mast|badhiya|zabardast|maza\s*aaya|khushkhabri|khabar\s*achhi)\b`),
  r("joy", 1.0, String.raw`(?:खुश|खुशी|बहुत अच्छा|बढ़िया|ज़बरदस्त|मज़ा आया|अच्छी खबर)`),
  r("joy", 1.0, String.raw`(?:ਖੁਸ਼|ਖੁਸ਼ੀ|ਬਹੁਤ ਵਧੀਆ|ਬਹੁਤ ਵਧੀਆ ਲੱਗਿਆ|ਵਧੀਆ ਖ਼ਬਰ|ਮਜ਼ਾ ਆਇਆ)`),

  // ── surprise ──
  r("surprise", 1.1, String.raw`\b(?:oh my|oh wow|wow|can'?t believe|didn'?t expect|never expected|what\?!|really\?!|no way|unexpected|shocked|seriously\?)\b`),
  r("surprise", 1.1, String.raw`\b(?:arre\s*wah|are\s*wah|kya\s*baat|sach\s*mein|yakeen\s*nahi|socha\s*nahi\s*tha|ummeed\s*nahi\s*thi\s*ki|hairaan|achanak|oh\s*ho)\b`),
  r("surprise", 1.1, String.raw`(?:हैरान|हैरानी|यकीन नहीं|यक़ीन नहीं|सोचा नहीं था|अचानक|अरे वाह|सच में\?|ओह)`),
  r("surprise", 1.1, String.raw`(?:ਹੈਰਾਨ|ਯਕੀਨ ਨਹੀਂ|ਸੋਚਿਆ ਨਹੀਂ ਸੀ|ਅਚਾਨਕ|ਓਹ ਵਾਹ|ਸੱਚੀਂ\?)`),

  // ── confusion ──
  r("confusion", 1.0, String.raw`\b(?:confused|don'?t understand|do not understand|not sure what|what do you mean|makes no sense|unclear|which one|how does that work|i'?m lost|no idea what)\b`),
  r("confusion", 1.0, String.raw`\b(?:samajh\s*(?:nahi|nahin)|samjh\s*nahi|kya\s*matlab|confuse|pata\s*nahi\s*kya|kuch\s*samajh|kaise\s*hoga\s*ye)\b`),
  r("confusion", 1.0, String.raw`(?:समझ नहीं|समझ में नहीं|क्या मतलब|उलझन|कन्फ्यूज|पता नहीं क्या करूँ|पता नहीं क्या करूं)`),
  r("confusion", 1.0, String.raw`(?:ਸਮਝ ਨਹੀਂ|ਸਮਝ ਨਹੀਂ ਆ|ਕੀ ਮਤਲਬ|ਉਲਝਣ|ਕਨਫਿਊਜ਼)`),

  // ── worry ──
  r("worry", 1.0, String.raw`\b(?:worried|worry|worrying|anxious|nervous|concerned|uneasy|on edge|what if|hope (?:it'?s|it is) not|afraid (?:it|that)|stress(?:ed)?)\b`),
  r("worry", 1.0, String.raw`\b(?:chinta|fikr|fikar|ghabrahat|tension|dar\s*lag\s*raha\s*hai\s*ki|pareshaan|pareshan|bechain|kahin\s*kuch|kya\s*hoga)\b`),
  r("worry", 1.0, String.raw`(?:चिंता|फिक्र|घबराहट|परेशान|बेचैन|टेंशन|कहीं कुछ|क्या होगा)`),
  r("worry", 1.0, String.raw`(?:ਚਿੰਤਾ|ਫਿਕਰ|ਘਬਰਾਹਟ|ਪਰੇਸ਼ਾਨ|ਬੇਚੈਨ|ਟੈਨਸ਼ਨ|ਕਿਤੇ ਕੁਝ|ਕੀ ਹੋਵੇਗਾ)`),

  // ── fear ──
  r("fear", 1.2, String.raw`\b(?:scared|afraid|terrified|frightened|fear|petrified|panick?ed? about)\b`),
  r("fear", 1.2, String.raw`\b(?:dar(?:\s*(?:lag|raha|rahi|gaya|gayi))|darr|dara\s*hua|bahut\s*dar|khauf)\b`),
  r("fear", 1.2, String.raw`(?:डर|डरा|डरी|भय|खौफ़|खौफ)`),
  r("fear", 1.2, String.raw`(?:ਡਰ|ਡਰਿਆ|ਡਰੀ|ਖੌਫ਼|ਖੌਫ)`),

  // ── sadness ──
  r("sadness", 1.0, String.raw`\b(?:sad|lonely|alone|depressed|crying|cried|miss (?:him|her|them)|heartbroken|grieving|feel(?:ing)? (?:low|empty|down)|no one (?:cares|is there)|passed away)\b`),
  r("sadness", 1.0, String.raw`\b(?:udaas|udas|akela|akeli|ro\s*raha|ro\s*rahi|rona\s*aa|dukhi|gham|toot\s*gaya|toot\s*gayi|man\s*nahi\s*lag|yaad\s*aa\s*rahi|guzar\s*gaye|guzar\s*gayi)\b`),
  r("sadness", 1.0, String.raw`(?:उदास|अकेला|अकेली|रो रहा|रो रही|रोना आ|दुखी|गम|ग़म|टूट गया|टूट गई|मन नहीं लग|याद आ रही|गुज़र गए|गुजर गए)`),
  r("sadness", 1.0, String.raw`(?:ਉਦਾਸ|ਇਕੱਲਾ|ਇਕੱਲੀ|ਰੋ ਰਿਹਾ|ਰੋ ਰਹੀ|ਦੁਖੀ|ਗ਼ਮ|ਗਮ|ਟੁੱਟ ਗਿਆ|ਮਨ ਨਹੀਂ ਲੱਗ|ਯਾਦ ਆ ਰਹੀ)`),

  // ── distress (crisis) ──
  r("distress", 1.5, String.raw`\b(?:can'?t (?:take|cope|breathe|go on|do this|handle)|help me|please help|save me|give up|end (?:it|my life)|want to die|kill myself|no way out|breaking down|panic(?:king)?|emergency)\b`),
  r("distress", 1.5, String.raw`\b(?:bachao|meri\s*madad|madad\s*karo|saans\s*nahi|jeena\s*nahi|marna\s*chahta|marna\s*chahti|himmat\s*nahi|bardasht\s*nahi|sehen\s*nahi|aur\s*nahi\s*seh|haar\s*gaya|haar\s*gayi|ghabra\s*raha)\b`),
  r("distress", 1.5, String.raw`(?:बचाओ|मेरी मदद|मदद करो|साँस नहीं|सांस नहीं|जीना नहीं|मरना चाह|हिम्मत नहीं|बर्दाश्त नहीं|सहन नहीं|हार गया|हार गई|घबरा रहा|घबरा रही)`),
  r("distress", 1.5, String.raw`(?:ਬਚਾਓ|ਮੇਰੀ ਮਦਦ|ਮਦਦ ਕਰੋ|ਸਾਹ ਨਹੀਂ|ਜੀਣਾ ਨਹੀਂ|ਮਰਨਾ ਚਾਹ|ਹਿੰਮਤ ਨਹੀਂ|ਬਰਦਾਸ਼ਤ ਨਹੀਂ|ਸਹਿ ਨਹੀਂ|ਹਾਰ ਗਿਆ|ਹਾਰ ਗਈ)`),

  // ── disappointment ──
  r("disappointment", 1.0, String.raw`\b(?:disappoint(?:ed|ing|ment)?|let (?:me|us) down|expected (?:better|more)|not what i (?:expected|hoped)|such a shame|bummed|underwhelming)\b`),
  r("disappointment", 1.0, String.raw`\b(?:nirash|niraash|nirasha|umeed\s*nahi\s*thi|ummeed\s*thi\s*par|afsos|bura\s*laga|mayoos|dil\s*toot)\b`),
  r("disappointment", 1.0, String.raw`(?:निराश|निराशा|उम्मीद थी|उम्मीद नहीं थी|अफसोस|अफ़सोस|बुरा लगा|मायूस)`),
  r("disappointment", 1.0, String.raw`(?:ਨਿਰਾਸ਼|ਨਿਰਾਸ਼ਾ|ਉਮੀਦ ਸੀ|ਉਮੀਦ ਨਹੀਂ ਸੀ|ਅਫ਼ਸੋਸ|ਅਫਸੋਸ|ਬੁਰਾ ਲੱਗਿਆ|ਮਾਯੂਸ)`),

  // ── frustration ──
  r("frustration", 1.0, String.raw`\b(?:frustrat\w*|fed up|sick of|tired of|annoy\w*|irritat\w*|again and again|third time|still (?:waiting|not|no)|no one (?:calls|responds|answers)|waiting (?:for|since)|always (?:late|busy)|every time)\b`),
  r("frustration", 1.0, String.raw`\b(?:pareshan\s*kar|tang\s*aa\s*gaya|tang\s*aa\s*gayi|baar\s*baar|kitni\s*baar|phir\s*se|abhi\s*tak\s*nahi|koi\s*jawab\s*nahi|intezaar\s*kar|thak\s*gaya|thak\s*gayi|bore|irritate)\b`),
  r("frustration", 1.0, String.raw`(?:तंग आ|बार बार|बार-बार|कितनी बार|अभी तक नहीं|कोई जवाब नहीं|इंतज़ार कर|इंतजार कर|थक गया|थक गई|चिढ़|परेशान कर)`),
  r("frustration", 1.0, String.raw`(?:ਤੰਗ ਆ|ਵਾਰ ਵਾਰ|ਕਿੰਨੀ ਵਾਰ|ਹਾਲੇ ਤੱਕ ਨਹੀਂ|ਕੋਈ ਜਵਾਬ ਨਹੀਂ|ਇੰਤਜ਼ਾਰ ਕਰ|ਥੱਕ ਗਿਆ|ਥੱਕ ਗਈ|ਪਰੇਸ਼ਾਨ ਕਰ)`),

  // ── anger ──
  r("anger", 1.3, String.raw`\b(?:furious|outrag\w*|angry|livid|how dare|ridiculous|unacceptable|disgusting|worst|useless|complain|sue|legal action|speak to (?:your )?(?:manager|supervisor)|idiots?|stupid)\b`),
  r("anger", 1.3, String.raw`\b(?:gussa|ghussa|bhadak|bakwaas|bakwas|bewakoof|nikamm?[ae]|shikayat|complaint\s*karunga|complaint\s*karungi|manager\s*se\s*baat|kaise\s*himmat|bekaar|badtameez)\b`),
  r("anger", 1.3, String.raw`(?:गुस्सा|ग़ुस्सा|भड़क|बकवास|बेवकूफ|निकम्मे|शिकायत करूँगा|शिकायत करूंगा|शिकायत करूँगी|शिकायत करूंगी|मैनेजर से बात|कैसे हिम्मत|बेकार|बदतमीज़|बदतमीज)`),
  r("anger", 1.3, String.raw`(?:ਗੁੱਸਾ|ਗੁੱਸੇ|ਭੜਕ|ਬਕਵਾਸ|ਬੇਵਕੂਫ|ਨਿਕੰਮੇ|ਸ਼ਿਕਾਇਤ ਕਰਾਂਗਾ|ਸ਼ਿਕਾਇਤ ਕਰਾਂਗੀ|ਮੈਨੇਜਰ ਨਾਲ ਗੱਲ|ਕਿਵੇਂ ਹਿੰਮਤ|ਬੇਕਾਰ|ਬਦਤਮੀਜ਼)`),

  // ── calm ──
  r("calm", 0.9, String.raw`\b(?:no hurry|take your time|no rush|i'?m fine|all good|doing okay|relaxed|peaceful|at ease|no worries)\b`),
  r("calm", 0.9, String.raw`\b(?:aaram\s*se|koi\s*jaldi\s*nahi|jaldi\s*nahi|sab\s*theek|bilkul\s*theek|shaant|shant|tension\s*nahi|araam)\b`),
  r("calm", 0.9, String.raw`(?:आराम से|कोई जल्दी नहीं|जल्दी नहीं|सब ठीक|बिलकुल ठीक|शांत|टेंशन नहीं)`),
  r("calm", 0.9, String.raw`(?:ਆਰਾਮ ਨਾਲ|ਕੋਈ ਕਾਹਲੀ ਨਹੀਂ|ਕਾਹਲੀ ਨਹੀਂ|ਸਭ ਠੀਕ|ਬਿਲਕੁਲ ਠੀਕ|ਸ਼ਾਂਤ|ਟੈਨਸ਼ਨ ਨਹੀਂ)`),
];

/** Wins ties: more severe / safety-relevant first. */
const PRIORITY: EmotionLabel[] = [
  "distress", "pain", "fear", "anger", "frustration", "worry", "sadness", "disappointment",
  "relief", "gratitude", "excitement", "joy", "surprise", "confusion", "calm", "neutral",
];

export interface MultilingualEmotionMatch {
  label: EmotionLabel;
  /** Summed rule weight for the winning label. */
  score: number;
}

/** Best label by summed rule weight, or null when no rule fires. */
export function matchMultilingualEmotion(text: string): MultilingualEmotionMatch | null {
  const scores = new Map<EmotionLabel, number>();
  for (const rule of RULES) {
    if (rule.re.test(text)) scores.set(rule.label, (scores.get(rule.label) ?? 0) + rule.w);
  }
  if (scores.size === 0) return null;
  let best: EmotionLabel | null = null;
  for (const [label, s] of scores) {
    if (
      best === null ||
      s > (scores.get(best) ?? 0) ||
      (s === scores.get(best) && PRIORITY.indexOf(label) < PRIORITY.indexOf(best))
    ) {
      best = label;
    }
  }
  return best ? { label: best, score: scores.get(best) ?? 0 } : null;
}
