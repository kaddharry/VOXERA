import type { EmotionLabel, VAD } from "../types";

// Compact lexicon mapping keywords to (label, VAD offset, weight).
// Used by the text emotion detector. Keeps the demo dependency-free.
// VAD in [-1, 1]^3.
export const LEXICON: Array<{
  kw: RegExp;
  label: EmotionLabel;
  vad: VAD;
  w: number;
}> = [
  // ── Anger ──────────────────────────────────────────────────────────────
  { kw: /\b(furious|outrag|raging|pissed|terrible|awful|horrible)\b/i, label: "anger", vad: { v: -0.8, a: 0.9, d: 0.5 }, w: 1.0 },
  { kw: /\b(angry|mad|annoyed)\b/i, label: "anger", vad: { v: -0.6, a: 0.7, d: 0.3 }, w: 0.8 },

  // ── Frustration ────────────────────────────────────────────────────────
  { kw: /\b(frustrat|fed up|tired of|sick of|again|third time|second time|still broken|painful|headache|wait)\b/i, label: "frustration", vad: { v: -0.6, a: 0.6, d: 0.2 }, w: 0.9 },
  { kw: /\b(losing (work|money|business)|can't work|costing me)\b/i, label: "frustration", vad: { v: -0.7, a: 0.7, d: 0.3 }, w: 1.0 },
  { kw: /\b(ridiculous|unacceptable|useless|pointless|waste of time)\b/i, label: "frustration", vad: { v: -0.5, a: 0.6, d: 0.2 }, w: 0.8 },

  // ── Distress ───────────────────────────────────────────────────────────
  { kw: /\b(desperate|help me|emergency|urgent|scared|afraid)\b/i, label: "distress", vad: { v: -0.8, a: 0.8, d: -0.3 }, w: 1.0 },
  { kw: /\b(suicid|harm myself|end it)\b/i, label: "distress", vad: { v: -0.95, a: 0.9, d: -0.6 }, w: 1.5 },

  // ── Sadness ────────────────────────────────────────────────────────────
  { kw: /\b(sad|down|depressed|miserable|unhappy|heartbroken|devastated|feeling low|feel low)\b/i, label: "sadness", vad: { v: -0.7, a: -0.3, d: -0.2 }, w: 0.8 },

  // ── Disappointment ─────────────────────────────────────────────────────
  { kw: /\b(disappoint|let down|let me down|expected (better|more)|not what i (hoped|expected)|unpaid|working for free)\b/i, label: "disappointment", vad: { v: -0.5, a: -0.1, d: -0.2 }, w: 0.8 },
  { kw: /\b(bummed|gutted|such a shame|too bad)\b/i, label: "disappointment", vad: { v: -0.4, a: -0.1, d: -0.1 }, w: 0.7 },

  // ── Fear ───────────────────────────────────────────────────────────────
  { kw: /\b(worried|anxious|nervous|terrified|panic)\b/i, label: "fear", vad: { v: -0.5, a: 0.5, d: -0.3 }, w: 0.7 },

  // ── Confusion ──────────────────────────────────────────────────────────
  { kw: /\b(confus|don'?t understand|not sure|unclear|what do you mean|lost)\b/i, label: "confusion", vad: { v: -0.2, a: 0.1, d: -0.2 }, w: 0.7 },
  { kw: /\b(how does that work|what does that mean|i don'?t get it)\b/i, label: "confusion", vad: { v: -0.1, a: 0.2, d: -0.2 }, w: 0.7 },

  // ── Joy ────────────────────────────────────────────────────────────────
  { kw: /\b(happy|glad|perfect|love it|wonderful|delighted|pleased)\b/i, label: "joy", vad: { v: 0.8, a: 0.5, d: 0.2 }, w: 0.8 },
  { kw: /\b(great( news)?|good( news)?|that's? (great|awesome|fantastic))\b/i, label: "joy", vad: { v: 0.7, a: 0.5, d: 0.3 }, w: 0.8 },

  // ── Excitement ─────────────────────────────────────────────────────────
  { kw: /\b(excit|can'?t wait|thrilled|pumped|stoked|hyped|ecstatic|sick)\b/i, label: "excitement", vad: { v: 0.9, a: 0.9, d: 0.4 }, w: 1.0 },
  { kw: /\b(amazing|incredible|awesome|insane|unbelievable|absolutely)\b/i, label: "excitement", vad: { v: 0.8, a: 0.7, d: 0.3 }, w: 0.8 },
  { kw: /\b(got (a|an|the|my)|just got|i got|landed|accepted|admitted|selected|hired)\b/i, label: "excitement", vad: { v: 0.7, a: 0.7, d: 0.4 }, w: 0.9 },
  { kw: /\b(internship|promotion|offer|scholarship|award|prize|dream job|accepted)\b/i, label: "excitement", vad: { v: 0.8, a: 0.8, d: 0.4 }, w: 0.9 },
  { kw: /\b(celebrat|party|woohoo|yay|omg|oh my god|yes yes)\b/i, label: "excitement", vad: { v: 0.8, a: 0.9, d: 0.3 }, w: 0.9 },
  { kw: /\b(finally|at last|i did it|we did it|made it|nailed it)\b/i, label: "excitement", vad: { v: 0.7, a: 0.7, d: 0.5 }, w: 0.8 },
  { kw: /\b(proud|pride|accomplished|achievement|milestone)\b/i, label: "excitement", vad: { v: 0.7, a: 0.6, d: 0.5 }, w: 0.8 },

  // ── Gratitude ──────────────────────────────────────────────────────────
  { kw: /\b(thank(s| you)|appreciate|grateful|you'?re (the )?best|means a lot)\b/i, label: "gratitude", vad: { v: 0.7, a: 0.2, d: 0.1 }, w: 0.8 },

  // ── Stress ─────────────────────────────────────────────────────────────
  { kw: /\b(stress|overwhelm|burnt? out|can'?t (handle|cope|take|deal))\b/i, label: "distress", vad: { v: -0.6, a: 0.6, d: -0.3 }, w: 0.8 },
  { kw: /\b(too much|falling apart|breaking down|at (my|the) limit)\b/i, label: "distress", vad: { v: -0.6, a: 0.5, d: -0.4 }, w: 0.8 },

  // ── Relief ─────────────────────────────────────────────────────────────
  { kw: /\b(reliev|what a relief|thank god|phew|finally (over|done|fixed|resolved)|fixed)\b/i, label: "joy", vad: { v: 0.6, a: -0.2, d: 0.3 }, w: 0.7 },
];
