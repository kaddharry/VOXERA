import type { EmotionLabel, VAD } from "../types";

// Compact lexicon mapping keywords to (label, VAD offset, weight).
// Used by the text emotion detector. Keeps the demo dependency-free.
// VAD in [-1, 1]^3. All regexes use non-capturing groups and the global flag /g.

// BUG-E19: `\b` is ASCII-only in JavaScript regex (its definition of "word
// character" is [A-Za-z0-9_], full stop — the `u`/`i` flags don't change
// this). Devanagari characters are never \w, so `\bदर्द\b` matches NOTHING,
// not even standalone "दर्द" — confirmed directly before writing this.
// These two helpers build an equivalent boundary using a negative lookaround
// against the Devanagari Unicode block (U+0900–U+097F, covers the script
// plus its combining vowel signs/virama) instead, so a match doesn't bleed
// into or out of adjacent Devanagari characters.
const DEVA_START = "(?<![\\u0900-\\u097F])";
const DEVA_END = "(?![\\u0900-\\u097F])";
function devanagariWord(alternation: string): RegExp {
  return new RegExp(`${DEVA_START}(?:${alternation})${DEVA_END}`, "g");
}

export const LEXICON: Array<{
  kw: RegExp;
  label: EmotionLabel;
  vad: VAD;
  w: number;
}> = [
  // ── Anger ──────────────────────────────────────────────────────────────
  // BUG-E14: "outrag" was a bare stem meant to prefix-match "outrage" /
  // "outraged" / "outrageous", but the trailing \b that wraps the WHOLE
  // alternation applies to every branch — including this one — and
  // requires a word boundary immediately after "outrag" itself. None of
  // its real inflected forms end there (the next letter is always another
  // word character), so this never matched anything in real English.
  // `outrag\w*` lets the boundary land wherever the real word actually
  // ends instead.
  { kw: /\b(?:furious|outrag\w*|rag(?:ing|in'?)|pissed|terrible|awful|horrible)\b/ig, label: "anger", vad: { v: -0.8, a: 0.9, d: 0.5 }, w: 1.0 },
  { kw: /\b(?:angry|mad|annoyed)\b/ig, label: "anger", vad: { v: -0.6, a: 0.7, d: 0.3 }, w: 0.8 },

  // ── Frustration ────────────────────────────────────────────────────────
  // "wait" is deliberately NOT a standalone trigger — it fires on "I can't wait
// to start!" and "please wait". Only explicit waiting complaints count.
// BUG-E14: "frustrat" had the same dead-stem problem as "outrag" above —
// /\bfrustrat\b/ does not match "frustrated" or "frustrating", the two
// most natural ways anyone actually says this. `frustrat\w*` fixes it.
{ kw: /\b(?:frustrat\w*|fed up|tired of|sick of|yet again|again and again|third time|second time|still broken|still waiting|been waiting|waiting too long|waiting forever|waited too long|waited forever|long wait)\b/ig, label: "frustration", vad: { v: -0.6, a: 0.6, d: 0.2 }, w: 0.9 },
  { kw: /\b(?:los(?:ing|in'?) (?:work|money|business)|can't work|cost(?:ing|in'?) me)\b/ig, label: "frustration", vad: { v: -0.7, a: 0.7, d: 0.3 }, w: 1.0 },
  { kw: /\b(?:ridiculous|unacceptable|useless|pointless|waste of time)\b/ig, label: "frustration", vad: { v: -0.5, a: 0.6, d: 0.2 }, w: 0.8 },

  // ── Distress ───────────────────────────────────────────────────────────
  // "help me" was removed from this pattern — it's an extremely common,
  // mundane phrase ("can you help me book an appointment") that was
  // falsely triggering maximum-severity distress + human-escalation on
  // completely routine requests. "desperately need help", "please help me,
  // I'm scared" etc. still match via the other words in this list.
  { kw: /\b(?:desperate|emergency|urgent|scared|afraid)\b/ig, label: "distress", vad: { v: -0.8, a: 0.8, d: -0.3 }, w: 1.0 },
  // BUG-E14 (SAFETY CRITICAL): this was the same dead-stem/dead-boundary
  // bug as "outrag"/"frustrat" above, but on the self-harm detector —
  // the single most consequential pattern in this whole file. "suicid"
  // never matched "suicidal" or "suicide" (only a literal, almost never
  // actually typed/spoken, truncated form). "end it" required that EXACT
  // two-word phrase — "I think about ending it all", arguably the most
  // common real phrasing, matched nothing. "harm myself"/"kill myself"
  // missed their gerund forms ("harming"/"killing myself"). "die" doesn't
  // share a stem with "dying" (irregular spelling) so it never matched
  // that either. Confirmed via scripts/simulate-call-emotion.ts's "Call E"
  // run: "Sometimes I just think about ending it all" came back
  // completely neutral, and the very next turn ("I'm just overwhelmed")
  // fell through to the ONNX fallback, which read it as EXCITEMENT at
  // 0.89 confidence. Broadened to cover the common real phrasings a
  // distressed caller actually uses, erring toward over-triggering this
  // flag rather than under-triggering it.
  { kw: /\b(?:suicid\w*|harm(?:ing)? myself|hurt(?:ing)? myself|end(?:ing)? it(?: all)?|end(?:ing)? (?:my|this) life|die|died|dying|want(?:ed)? to die|wanna die|better off dead|don'?t want to (?:be here|live)(?: anymore)?|no reason to live|can'?t go on|giving up on (?:everything|life)|kill(?:ing)? myself|think(?:ing)? (?:about|of) (?:ending|hurting|harming|killing) (?:myself|it all|things|my life))\b/ig, label: "distress", vad: { v: -0.95, a: 0.9, d: -0.6 }, w: 1.5 },
  // Physical symptoms — a patient reporting pain or a worrying symptom is in
  // distress, not "frustrated" (where "painful"/"headache" used to sit, along
  // with a bare "again", which tagged "I'm feeling good again" as
  // frustration). Negation is handled by the detector ("no pain" → no match).
  { kw: /\b(?:pain|painful|hurts?|hurting|aching|aches?|headaches?|can'?t sleep|bleeding|swollen|swelling|fever|dizzy|vomit(?:ing)?|throwing up|can'?t breathe)\b/ig, label: "distress", vad: { v: -0.7, a: 0.5, d: -0.4 }, w: 0.9 },

  // ── Sadness ────────────────────────────────────────────────────────────
  { kw: /\b(?:sad|down|depressed|miserable|unhappy|heartbroken|devastated|feel(?:ing?|s|in'?)? (?:very |so |really |quite |a bit )?low|breakup|broken up|dumped)\b/ig, label: "sadness", vad: { v: -0.7, a: -0.3, d: -0.2 }, w: 0.8 },

  // ── Disappointment ─────────────────────────────────────────────────────
  // BUG-E14: "disappoint" alone doesn't match "disappointed"/"disappointing" either.
  { kw: /\b(?:disappoint\w*|let down|let me down|expected (?:better|more)|not what i (?:hoped|expected)|unpaid|work(?:ing|in'?) for free)\b/ig, label: "disappointment", vad: { v: -0.5, a: -0.1, d: -0.2 }, w: 0.8 },
  { kw: /\b(?:bummed|gutted|such a shame|too bad)\b/ig, label: "disappointment", vad: { v: -0.4, a: -0.1, d: -0.1 }, w: 0.7 },

  // ── Fear ───────────────────────────────────────────────────────────────
  { kw: /\b(?:worried|anxious|nervous|terrified|panic)\b/ig, label: "fear", vad: { v: -0.5, a: 0.5, d: -0.3 }, w: 0.7 },

  // ── Confusion ──────────────────────────────────────────────────────────
  // BUG-E14: "confus" didn't match "confused" or "confusing" — the two
  // most natural ways this emotion actually gets said out loud.
  { kw: /\b(?:confus\w*|don'?t understand|not sure|unclear|what do you mean|lost)\b/ig, label: "confusion", vad: { v: -0.2, a: 0.1, d: -0.2 }, w: 0.7 },
  { kw: /\b(?:how does that work|what does that mean|i don'?t get it)\b/ig, label: "confusion", vad: { v: -0.1, a: 0.2, d: -0.2 }, w: 0.7 },

  // ── Joy ────────────────────────────────────────────────────────────────
  { kw: /\b(?:happy|glad|perfect|love it|wonderful|delighted|pleased)\b/ig, label: "joy", vad: { v: 0.8, a: 0.5, d: 0.2 }, w: 0.8 },
  { kw: /\b(?:great(?: news)?|good(?: news)?|that's? (?:great|awesome|fantastic))\b/ig, label: "joy", vad: { v: 0.7, a: 0.5, d: 0.3 }, w: 0.8 },

  // ── Excitement ─────────────────────────────────────────────────────────
  // BUG-E6: "sick" used to be a bare trigger here (slang for "awesome"),
  // but in a clinical check-in app a patient reporting "I've been feeling
  // sick since the surgery" matched this pattern and scored as positive
  // excitement (v=+0.9) — a dangerous mislabel of a reported symptom. It
  // also out-competed the dedicated "sick of" frustration phrase below
  // (both patterns matched the same text; this one's weight was higher),
  // which is the exact collision __tests__/emotion/lexicon-frustration
  // .test.ts's `it.todo` already flagged. Removed; "thrilled"/"pumped"/
  // "stoked"/"hyped"/"ecstatic" carry the same enthusiasm without the
  // symptom-word collision.
  // BUG-E14: "excit" is the single most important miss in this category —
  // it didn't match "excited" or "exciting", the overwhelmingly normal way
  // to say this ("I'm so excited" matched NOTHING before this fix).
  { kw: /\b(?:excit\w*|can'?t wait|thrilled|pumped|stoked|hyped|ecstatic)\b/ig, label: "excitement", vad: { v: 0.9, a: 0.9, d: 0.4 }, w: 1.0 },
  // "absolutely" was here too, alongside genuinely-positive standalone words
  // like "amazing"/"awesome" — but "absolutely" is an INTENSIFIER, not a
  // sentiment word: "absolutely ridiculous" and "absolutely wonderful" are
  // opposite in valence, yet both matched this pattern and contributed the
  // same +0.8 valence regardless of what it was intensifying. Live-verified
  // this was flipping "This is absolutely ridiculous..." (unambiguously
  // negative) to a net-POSITIVE fused VAD (v=+0.15) once blended with the
  // correctly-negative "ridiculous" match — a real accuracy bug, not just a
  // theoretical one, and one the new persona-lock hysteresis (which reads
  // vad.v's sign) inherited directly. Removed; "amazing"/"incredible"/
  // "awesome"/"insane"/"unbelievable" are fine standalone since they carry
  // their own sentiment with or without an intensifier in front of them.
  { kw: /\b(?:amazing|incredible|awesome|insane|unbelievable)\b/ig, label: "excitement", vad: { v: 0.8, a: 0.7, d: 0.3 }, w: 0.8 },
  { kw: /\b(?:got (?:a|an|the|my)|just got|i got|landed|accepted|admitted|selected|hired)\b/ig, label: "excitement", vad: { v: 0.7, a: 0.7, d: 0.4 }, w: 0.9 },
  { kw: /\b(?:internship|promotion|offer|scholarship|award|prize|dream job|accepted)\b/ig, label: "excitement", vad: { v: 0.8, a: 0.8, d: 0.4 }, w: 0.9 },
  // BUG-E14: "celebrat" didn't match "celebrating" or "celebration" either.
  { kw: /\b(?:celebrat\w*|party|woohoo|yay|omg|oh my god|yes yes)\b/ig, label: "excitement", vad: { v: 0.8, a: 0.9, d: 0.3 }, w: 0.9 },
  { kw: /\b(?:finally|at last|i did it|we did it|made it|nailed it)\b/ig, label: "excitement", vad: { v: 0.7, a: 0.7, d: 0.5 }, w: 0.8 },
  { kw: /\b(?:proud|pride|accomplished|achievement|milestone)\b/ig, label: "excitement", vad: { v: 0.7, a: 0.6, d: 0.5 }, w: 0.8 },

  // ── Gratitude ──────────────────────────────────────────────────────────
  // BUG-E14: "appreciate" only matched that exact present-tense form —
  // "I really appreciated that" (past tense) matched nothing.
  { kw: /\b(?:thank(?:s| you)|appreciat\w*|grateful|you'?re (?:the )?best|means a lot)\b/ig, label: "gratitude", vad: { v: 0.7, a: 0.2, d: 0.1 }, w: 0.8 },

  // ── Stress ─────────────────────────────────────────────────────────────
  // BUG-E14: "stress" didn't match "stressed"/"stressful", and
  // "overwhelm" didn't match "overwhelmed" — the almost-always-used form
  // of both. Confirmed live in scripts/simulate-call-emotion.ts: "I'm just
  // overwhelmed" fell through to the ONNX fallback, which read it as
  // EXCITEMENT at 0.89 confidence, right after a turn about self-harm.
  { kw: /\b(?:stress\w*|overwhelm\w*|burnt? out|can'?t (?:handle|cope|take|deal))\b/ig, label: "distress", vad: { v: -0.6, a: 0.6, d: -0.3 }, w: 0.8 },
  { kw: /\b(?:too much|fall(?:ing|in'?) apart|break(?:ing|in'?) down|at (?:my|the) limit)\b/ig, label: "distress", vad: { v: -0.6, a: 0.5, d: -0.4 }, w: 0.9 },

  // ── Relief ─────────────────────────────────────────────────────────────
  // BUG-E14: "reliev" didn't match "relieved" — only "relieving"/"relieve" could, in theory.
  { kw: /\b(?:reliev\w*|what a relief|thank god|phew|finally (?:over|done|fixed|resolved)|fixed)\b/ig, label: "joy", vad: { v: 0.6, a: -0.2, d: 0.3 }, w: 0.7 },

  // ── Clinical trend — declining ────────────────────────────────────────
  // A post-op check-in call's whole purpose is catching a declining
  // patient, and this was entirely unhandled before. Deliberately
  // multi-word, not a bare "worse" — after BUG-E6 ("sick"), a bare "worse"
  // is the same kind of landmine: it collides with harmless hedges like
  // "well, it could be worse" or "worst case scenario".
  { kw: /\b(?:getting worse|gotten worse|feels? worse|pain(?:'s| is) worse|worse than (?:before|yesterday|this morning)|much worse|a lot worse|not healing (?:right|properly|well)|hasn'?t improved|isn'?t improving|still not (?:better|healing))\b/ig, label: "distress", vad: { v: -0.7, a: 0.5, d: -0.4 }, w: 1.0 },

  // ── Clinical trend — improving ────────────────────────────────────────
  // Also multi-word for the same reason — bare "better" is one of the most
  // overloaded words in English ("I'd better go", "a better plan").
  { kw: /\b(?:feeling (?:much |a lot |so much |any )?better|doing (?:much |a lot |so much |any )?better|much better now|healing (?:well|nicely|fine)|recovering well|on the mend|back to normal|getting better)\b/ig, label: "joy", vad: { v: 0.6, a: -0.2, d: 0.3 }, w: 0.8 },

  // BUG-E15: a SYMPTOM word (pain/headache/swelling/etc.) scores distress
  // unconditionally below, with no concept of the symptom being over —
  // "the pain has pretty much gone away" scored as distress (v=-0.7) in a
  // scripted happy/recovering call, because "pain" matched regardless of
  // the sentence reporting it as RESOLVED. Negation handling doesn't cover
  // this either (no negation word is present — "the pain is gone" doesn't
  // negate anything, it describes a past symptom as over). This resolution
  // phrase wins the LABEL vote against the plain "pain" match in the same
  // sentence, but detectTextEmotionLexicon's VAD is a weighted BLEND across
  // every match regardless of which label wins — at equal-ish weight the
  // two near-cancelled to a barely-negative v. Weighted well above the
  // plain symptom match (1.6 vs 0.9) so the blended VAD actually reads
  // positive, not just the label.
  { kw: /\b(?:pain(?:'s| is| has)? (?:pretty much |mostly |completely |totally |finally )?(?:gone(?: away| now)?|resolved|stopped|cleared up)|no more pain|pain[- ]free)\b/ig, label: "joy", vad: { v: 0.6, a: -0.2, d: 0.3 }, w: 1.6 },

  // ── More post-op physical symptoms ──────────────────────────────────────
  // The existing distress symptom list (pain/headache/fever/dizzy/vomiting)
  // missed several common post-surgical complaints.
  { kw: /\b(?:nauseous|nausea|queasy|numb(?:ness)?|tingling|infect(?:ed|ion)|pus|chills|shivering|light[- ]?headed|faint(?:ed|ing)?|exhausted|can'?t (?:move|walk)|weak(?:ness)?)\b/ig, label: "distress", vad: { v: -0.7, a: 0.4, d: -0.4 }, w: 0.9 },
  { kw: /\bdischarge (?:from|coming from) (?:the|my) (?:wound|incision|cut|site|stitches)\b/ig, label: "distress", vad: { v: -0.7, a: 0.4, d: -0.4 }, w: 0.9 },

  // ── Medication / dosage confusion ────────────────────────────────────────
  { kw: /\b(?:which (?:pill|medicine|medication|dose|tablet)|how much (?:medicine|medication) (?:to|should i) take|when (?:to|should i) take|what'?s the dosage|not sure (?:about|how much) (?:medicine|medication|dosage))\b/ig, label: "confusion", vad: { v: -0.2, a: 0.2, d: -0.2 }, w: 0.8 },

  // ── Healthcare-system frustration ─────────────────────────────────────────
  // Distinct from the generic "waiting" phrases above — specifically about
  // the hospital/clinic not responding, not just time passing.
  { kw: /\b(?:no(?:body| one) (?:called|calls|answers|answered|responds|responded|got back to me)|left (?:a |several )?messages?|put on hold|transferred (?:around|again|me again)|keeps? transferring me|no one tells me (?:anything|what)|nobody (?:tells|told) me)\b/ig, label: "frustration", vad: { v: -0.6, a: 0.6, d: 0.2 }, w: 0.9 },

  // ── Hinglish / romanized Hindi (code-switching) ───────────────────────────
  // BUG-E18: zero coverage before this. This app's visible call data is
  // overwhelmingly +91 (Indian) numbers, and code-switching — an otherwise
  // English sentence with Hindi/Hinglish words dropped in ("doctor, bahut
  // dard ho raha hai") — is extremely common Indian-English patient speech,
  // reaching this function as plain Latin-script text regardless of the
  // STT's configured language. This does NOT fix the deeper issue: the live
  // STT (lib/deepgram/live.ts) is hardcoded to language: "en", so a patient
  // speaking PRIMARILY Hindi may not transcribe accurately at all — that's
  // a product-level STT configuration decision with cost/tier/accuracy
  // trade-offs for every call, not something a lexicon change can fix. This
  // only covers code-switched words that already reach the engine as
  // readable text today. Multi-word phrases used wherever a bare root would
  // be short enough to risk colliding with unrelated English/names (short
  // Hindi roots like "dar"/"mar" are NOT used bare, same discipline as
  // BUG-E6's "sick" lesson).
  { kw: /\b(?:dard|takleef|bukhar|ulti|kamzori|sujan)\b/ig, label: "distress", vad: { v: -0.7, a: 0.5, d: -0.4 }, w: 0.9 },
  { kw: /\b(?:pareshan\w*|ghabra\w*)\b/ig, label: "fear", vad: { v: -0.5, a: 0.5, d: -0.3 }, w: 0.7 },
  { kw: /\b(?:samajh nahi|pata nahi)\b/ig, label: "confusion", vad: { v: -0.2, a: 0.1, d: -0.2 }, w: 0.7 },
  { kw: /\b(?:shukriya|dhanyav?ad)\b/ig, label: "gratitude", vad: { v: 0.7, a: 0.2, d: 0.1 }, w: 0.8 },
  // Self-harm in Hindi/Hinglish — same severity class and "err toward
  // over-triggering" discipline as the English pattern (BUG-E14).
  { kw: /\b(?:marne ka man|marna chahta|jeena nahi chahta|khud ko khatam|zindagi khatam)\b/ig, label: "distress", vad: { v: -0.95, a: 0.9, d: -0.6 }, w: 1.5 },

  // ── Devanagari-script Hindi ──────────────────────────────────────────────
  // Complementary to the Hinglish (Latin-script) entries above — only
  // reachable if CONFIG.deepgram.sttHindiCodeSwitching is ever turned on
  // (see its doc comment in lib/config.ts). Deepgram's documented Hindi
  // output on nova-2/nova-3 is Devanagari script, not romanized text, so the
  // Latin-script entries above would never match a caller's actual Hindi
  // speech transcribed that way — only code-switched Hinglish WORDS dropped
  // into an English sentence. Same word list as the Hinglish section,
  // written in-script; see devanagariWord()'s comment above for why these
  // can't use the ordinary \b(?:...)\b the rest of this file uses.
  { kw: devanagariWord("दर्द|तकलीफ|बुखार|उल्टी|कमजोरी|सूजन"), label: "distress", vad: { v: -0.7, a: 0.5, d: -0.4 }, w: 0.9 },
  { kw: devanagariWord("परेशान|घबराहट|घबरा"), label: "fear", vad: { v: -0.5, a: 0.5, d: -0.3 }, w: 0.7 },
  { kw: devanagariWord("समझ नहीं|पता नहीं"), label: "confusion", vad: { v: -0.2, a: 0.1, d: -0.2 }, w: 0.7 },
  { kw: devanagariWord("शुक्रिया|धन्यवाद"), label: "gratitude", vad: { v: 0.7, a: 0.2, d: 0.1 }, w: 0.8 },
  { kw: devanagariWord("मरने का मन|मरना चाहता|जीना नहीं चाहता|खुद को खत्म|जिंदगी खत्म"), label: "distress", vad: { v: -0.95, a: 0.9, d: -0.6 }, w: 1.5 },
];
