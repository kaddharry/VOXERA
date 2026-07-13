import type { EmotionLabel, VAD } from "../types";

// Compact lexicon mapping keywords to (label, VAD offset, weight).
// Used by the text emotion detector. Keeps the demo dependency-free.
// VAD in [-1, 1]^3. All regexes use non-capturing groups and the global flag /g.
export const LEXICON: Array<{
  kw: RegExp;
  label: EmotionLabel;
  vad: VAD;
  w: number;
}> = [
  // ── Anger ──────────────────────────────────────────────────────────────
  { kw: /\b(?:furious|outrag|rag(?:ing|in'?)|pissed|terrible|awful|horrible)\b/ig, label: "anger", vad: { v: -0.8, a: 0.9, d: 0.5 }, w: 1.0 },
  { kw: /\b(?:angry|mad|annoyed)\b/ig, label: "anger", vad: { v: -0.6, a: 0.7, d: 0.3 }, w: 0.8 },

  // ── Frustration ────────────────────────────────────────────────────────
  { kw: /\b(?:frustrat|fed up|tired of|sick of|again|third time|second time|still broken|painful|headache|wait)\b/ig, label: "frustration", vad: { v: -0.6, a: 0.6, d: 0.2 }, w: 0.9 },
  { kw: /\b(?:los(?:ing|in'?) (?:work|money|business)|can't work|cost(?:ing|in'?) me)\b/ig, label: "frustration", vad: { v: -0.7, a: 0.7, d: 0.3 }, w: 1.0 },
  { kw: /\b(?:ridiculous|unacceptable|useless|pointless|waste of time)\b/ig, label: "frustration", vad: { v: -0.5, a: 0.6, d: 0.2 }, w: 0.8 },

  // ── Distress ───────────────────────────────────────────────────────────
  { kw: /\b(?:desperate|help me|emergency|urgent|scared|afraid)\b/ig, label: "distress", vad: { v: -0.8, a: 0.8, d: -0.3 }, w: 1.0 },
  { kw: /\b(?:suicid|harm myself|end it|die|kill myself|wanna die)\b/ig, label: "distress", vad: { v: -0.95, a: 0.9, d: -0.6 }, w: 1.5 },

  // ── Sadness ────────────────────────────────────────────────────────────
  { kw: /\b(?:sad|down|depressed|miserable|unhappy|heartbroken|devastated|feel(?:ing?|s|in'?)? low|breakup|broken up|dumped)\b/ig, label: "sadness", vad: { v: -0.7, a: -0.3, d: -0.2 }, w: 0.8 },

  // ── Disappointment ─────────────────────────────────────────────────────
  { kw: /\b(?:disappoint|let down|let me down|expected (?:better|more)|not what i (?:hoped|expected)|unpaid|work(?:ing|in'?) for free)\b/ig, label: "disappointment", vad: { v: -0.5, a: -0.1, d: -0.2 }, w: 0.8 },
  { kw: /\b(?:bummed|gutted|such a shame|too bad)\b/ig, label: "disappointment", vad: { v: -0.4, a: -0.1, d: -0.1 }, w: 0.7 },

  // ── Fear ───────────────────────────────────────────────────────────────
  { kw: /\b(?:worried|anxious|nervous|terrified|panic)\b/ig, label: "fear", vad: { v: -0.5, a: 0.5, d: -0.3 }, w: 0.7 },

  // ── Confusion ──────────────────────────────────────────────────────────
  { kw: /\b(?:confus|don'?t understand|not sure|unclear|what do you mean|lost)\b/ig, label: "confusion", vad: { v: -0.2, a: 0.1, d: -0.2 }, w: 0.7 },
  { kw: /\b(?:how does that work|what does that mean|i don'?t get it)\b/ig, label: "confusion", vad: { v: -0.1, a: 0.2, d: -0.2 }, w: 0.7 },

  // ── Joy ────────────────────────────────────────────────────────────────
  { kw: /\b(?:happy|glad|perfect|love it|wonderful|delighted|pleased)\b/ig, label: "joy", vad: { v: 0.8, a: 0.5, d: 0.2 }, w: 0.8 },
  { kw: /\b(?:great(?: news)?|good(?: news)?|that's? (?:great|awesome|fantastic))\b/ig, label: "joy", vad: { v: 0.7, a: 0.5, d: 0.3 }, w: 0.8 },

  // ── Excitement ─────────────────────────────────────────────────────────
  { kw: /\b(?:excit|can'?t wait|thrilled|pumped|stoked|hyped|ecstatic|sick)\b/ig, label: "excitement", vad: { v: 0.9, a: 0.9, d: 0.4 }, w: 1.0 },
  { kw: /\b(?:amazing|incredible|awesome|insane|unbelievable|absolutely)\b/ig, label: "excitement", vad: { v: 0.8, a: 0.7, d: 0.3 }, w: 0.8 },
  { kw: /\b(?:got (?:a|an|the|my)|just got|i got|landed|accepted|admitted|selected|hired)\b/ig, label: "excitement", vad: { v: 0.7, a: 0.7, d: 0.4 }, w: 0.9 },
  { kw: /\b(?:internship|promotion|offer|scholarship|award|prize|dream job|accepted)\b/ig, label: "excitement", vad: { v: 0.8, a: 0.8, d: 0.4 }, w: 0.9 },
  { kw: /\b(?:celebrat|party|woohoo|yay|omg|oh my god|yes yes)\b/ig, label: "excitement", vad: { v: 0.8, a: 0.9, d: 0.3 }, w: 0.9 },
  { kw: /\b(?:finally|at last|i did it|we did it|made it|nailed it)\b/ig, label: "excitement", vad: { v: 0.7, a: 0.7, d: 0.5 }, w: 0.8 },
  { kw: /\b(?:proud|pride|accomplished|achievement|milestone)\b/ig, label: "excitement", vad: { v: 0.7, a: 0.6, d: 0.5 }, w: 0.8 },

  // ── Gratitude ──────────────────────────────────────────────────────────
  { kw: /\b(?:thank(?:s| you)|appreciate|grateful|you'?re (?:the )?best|means a lot)\b/ig, label: "gratitude", vad: { v: 0.7, a: 0.2, d: 0.1 }, w: 0.8 },

  // ── Stress ─────────────────────────────────────────────────────────────
  { kw: /\b(?:stress|overwhelm|burnt? out|can'?t (?:handle|cope|take|deal))\b/ig, label: "distress", vad: { v: -0.6, a: 0.6, d: -0.3 }, w: 0.8 },
  { kw: /\b(?:too much|fall(?:ing|in'?) apart|break(?:ing|in'?) down|at (?:my|the) limit)\b/ig, label: "distress", vad: { v: -0.6, a: 0.5, d: -0.4 }, w: 0.9 },

  // ── Relief ─────────────────────────────────────────────────────────────
  { kw: /\b(?:reliev|what a relief|thank god|phew|finally (?:over|done|fixed|resolved)|fixed)\b/ig, label: "joy", vad: { v: 0.6, a: -0.2, d: 0.3 }, w: 0.7 },
];
