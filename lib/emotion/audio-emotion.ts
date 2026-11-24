/**
 * Acoustic Emotion Analysis — Maps acoustic features to EmotionSignal.
 *
 * Replaces the previous rigid if/else chain with a scored approach where
 * multiple features contribute weighted scores to each candidate label.
 *
 * Key improvements over v1:
 * - Crying/sobbing detection (high pitch + broken speech + high energy modulation)
 * - Laughter detection (high ZCR + rapid energy modulation + mid-high pitch)
 * - ZCR is now used in label inference (was previously extracted but ignored)
 * - Scored multi-feature inference instead of rigid if/else chain
 * - Raised confidence ceiling to 0.85 for long utterances with clear patterns
 * - Energy modulation rate and pitch contour are used when available
 */

import type { AcousticFeatures, EmotionLabel, EmotionSignal, VAD } from "../types";
import { CONFIG } from "../config";
import { clamp } from "../util/math";
import { classifyConfidence } from "./confidence";

/**
 * Derive an EmotionSignal from physical acoustic features.
 *
 * Confidence scales with audio duration and pattern clarity:
 * - <2s = low confidence (0.30)
 * - 2-5s = medium (0.45–0.65)
 * - 5-8s = high (0.65–0.75)
 * - >8s with clear patterns = very high (up to 0.85)
 */
export function detectAudioEmotion(
  features: AcousticFeatures,
  opts?: {
    /**
     * Manual calibration knob (-1..1, default 0) for the acoustic engine's
     * documented tendency to over-read ambiguous audio as negative (quiet/
     * flat speech reads as sadness/distress more easily than it reads as
     * calm/positive — a known weakness of DSP-heuristic scoring, not unique
     * to this implementation). Positive values nudge scoring toward
     * joy/gratitude/excitement/calm; negative values nudge toward
     * sadness/distress/fear/anger/frustration/disappointment. 0 = unchanged
     * behavior. Applied as a scoring adjustment in inferLabelScored, not a
     * post-hoc relabel, so it can actually flip which label wins on
     * borderline cases instead of just cosmetically shifting a VAD number.
     */
    sensitivityBias?: number;
  }
): (EmotionSignal & { acousticSignalHint?: "crying" | "laughing" }) | null {
  // Minimum meaningful analysis requires at least 500ms of audio
  if (features.durationMs < 500) return null;

  // ─── Normalize features to 0-1 ranges ──────────────────────────────────

  // RMS energy: typical speech 800-6000 for 16-bit, normalize to 0-1
  const energyNorm = clamp(features.rmsEnergy / 5000, 0, 1);

  // Pitch: 70-400Hz range → 0-1
  const pitchNorm = features.pitchHz > 0 ? clamp((features.pitchHz - 70) / 330, 0, 1) : 0.5;

  // Speaking rate: 60-220 WPM → 0-1
  const rateNorm = clamp((features.speakingRateWPM - 60) / 160, 0, 1);

  // Pause ratio: fraction of total duration spent in pauses
  const pauseRatio = features.durationMs > 0
    ? clamp(features.pauseDurationMs / features.durationMs, 0, 1)
    : 0;

  // ZCR: already 0-1 from extraction
  const zcr = features.zeroCrossingRate;

  // Energy modulation: 0-1 (high = rapid amplitude changes like crying/laughter)
  const energyMod = features.energyModulationRate ?? 0;

  // Pitch contour: direction of pitch across the utterance
  const contour = features.pitchContour ?? "flat";

  // ─── VAD computation from acoustic features ────────────────────────────

  // Valence: harder to determine from audio alone. Use rate + pitch variation
  // as weak proxies. Fast + varied = likely positive; slow + monotone = likely negative.
  let valence = 0;
  valence += (features.pitchVariation - 0.3) * 0.6;   // High variation → positive
  valence += (rateNorm - 0.5) * 0.3;                   // Fast → slightly positive
  valence -= pauseRatio * 0.3;                          // Pauses → slightly negative
  // Unstable pitch contour suggests distress
  if (contour === "unstable") valence -= 0.2;
  valence = clamp(valence, -1, 1);

  // Arousal: strongly correlated with energy, pitch, and rate
  let arousal = 0;
  arousal += energyNorm * 0.5;
  arousal += pitchNorm * 0.25;
  arousal += rateNorm * 0.25;
  arousal = clamp(arousal * 2 - 0.5, -1, 1); // Center around 0

  // Dominance: loud + fast = dominant; quiet + slow + pauses = submissive
  let dominance = 0;
  dominance += energyNorm * 0.4;
  dominance += rateNorm * 0.3;
  dominance -= pauseRatio * 0.3;
  dominance = clamp(dominance * 2 - 0.5, -1, 1);

  const vad: VAD = { v: valence, a: arousal, d: dominance };

  // ─── Scored label inference ────────────────────────────────────────────

  const { label, patternStrength, signalHint } = inferLabelScored({
    energy: energyNorm,
    pitch: pitchNorm,
    pitchVariation: features.pitchVariation,
    rate: rateNorm,
    pauseRatio,
    zcr,
    energyMod,
    contour,
    pauseCount: features.pauseCount,
    vad,
    // Very low amplitude is treated as a soft, contextual nudge toward several
    // plausible "subdued" states at once (never a direct label mapping — see
    // inferLabelScored) rather than a confident signal on its own.
    quiet: energyNorm < 0.15,
    sensitivityBias: clamp(opts?.sensitivityBias ?? 0, -1, 1),
  });

  // ─── Confidence based on audio duration + pattern clarity ──────────────

  const { audioConfidenceCeiling, audioConfidenceCeilingLong } = CONFIG.emotion;
  let confidence: number;
  if (features.durationMs < 2000) {
    confidence = 0.3;  // Very short — low confidence
  } else if (features.durationMs < 5000) {
    confidence = 0.45 + (features.durationMs - 2000) / 15000; // 0.45–0.65
  } else if (features.durationMs < 8000) {
    confidence = Math.min(audioConfidenceCeiling, 0.65 + (features.durationMs - 5000) / 50000);
  } else {
    // Long utterances with clear acoustic patterns get higher confidence
    confidence = Math.min(
      audioConfidenceCeilingLong,
      0.70 + (features.durationMs - 8000) / 100000 + patternStrength * 0.1
    );
  }

  const intensity = clamp(Math.sqrt(vad.v * vad.v + vad.a * vad.a + vad.d * vad.d) / Math.sqrt(3));

  return {
    label,
    intensity,
    confidence,
    confidenceCategory: classifyConfidence(confidence),
    vad,
    source: "audio",
    at: Date.now(),
    ...(signalHint ? { acousticSignalHint: signalHint } : {}),
  };
}

// ─── Scored Label Inference ──────────────────────────────────────────────────

interface NormalizedFeatures {
  energy: number;
  pitch: number;
  pitchVariation: number;
  rate: number;
  pauseRatio: number;
  zcr: number;
  energyMod: number;
  contour: "rising" | "falling" | "flat" | "unstable";
  pauseCount: number;
  vad: VAD;
  /** Very low amplitude — used only as a soft multi-label nudge, see below. */
  quiet: boolean;
  /** Manual calibration bias (-1..1, 0 = off) — see detectAudioEmotion()'s opts doc. */
  sensitivityBias: number;
}

/**
 * Multi-feature scored label inference.
 * Each candidate label accumulates a score based on feature contributions.
 * Returns the highest-scoring label and a pattern strength (0-1) indicating
 * how clear/distinctive the acoustic pattern is.
 */
const POSITIVE_LABELS: EmotionLabel[] = ["joy", "gratitude", "excitement", "calm"];
const NEGATIVE_LABELS: EmotionLabel[] = ["sadness", "distress", "fear", "anger", "frustration", "disappointment"];

function inferLabelScored(
  f: NormalizedFeatures
): { label: EmotionLabel; patternStrength: number; signalHint?: "crying" | "laughing" } {
  const scores: Record<EmotionLabel, number> = {
    neutral: 0,
    calm: 0,
    anger: 0,
    frustration: 0,
    sadness: 0,
    distress: 0,
    fear: 0,
    confusion: 0,
    joy: 0,
    gratitude: 0,
    excitement: 0,
    disappointment: 0,
    relief: 0,
    surprise: 0,
    worry: 0,
    pain: 0,
  };

  // ── Anger: high energy, high pitch, fast rate, LOW pitch variation (controlled rage)
  if (f.energy > 0.6) scores.anger += 0.3;
  if (f.pitch > 0.5) scores.anger += 0.2;
  if (f.rate > 0.6) scores.anger += 0.2;
  if (f.pitchVariation < 0.25) scores.anger += 0.3; // Monotone loud = angry
  if (f.energy > 0.7 && f.pitchVariation < 0.2) scores.anger += 0.2; // Strong signal

  // ── Excitement: high energy, high pitch, fast rate, HIGH pitch variation
  if (f.energy > 0.5) scores.excitement += 0.2;
  if (f.pitch > 0.5) scores.excitement += 0.15;
  if (f.rate > 0.5) scores.excitement += 0.15;
  if (f.pitchVariation > 0.4) scores.excitement += 0.3;
  if (f.energy > 0.4 && f.pitchVariation > 0.5) scores.excitement += 0.2;

  // ── Sadness: previously scored independently on low energy OR low pitch OR
  // slow rate OR low variation OR a falling contour — each alone is also
  // exactly what plain calm/neutral speech or warm gratitude sounds like
  // (see the gratitude rules below, and the "quiet" soft nudge further
  // down), so nearly any unhurried, non-animated speaker racked up a higher
  // sadness score than anything else purely from being calm. This was the
  // "everything gets read as sad" bias reported in live testing. Now energy
  // AND pitch must BOTH be genuinely low together for the primary signal —
  // a single weak cue is no longer enough — and pitch variation/contour are
  // downgraded to smaller supporting nudges that also require low energy.
  if (f.energy < 0.25 && f.pitch < 0.35) scores.sadness += 0.35;
  if (f.energy < 0.3 && f.rate < 0.3) scores.sadness += 0.15;
  if (f.pitchVariation < 0.15 && f.energy < 0.35) scores.sadness += 0.15;
  if (f.contour === "falling" && f.energy < 0.3) scores.sadness += 0.1;

  // ── Crying/Sobbing → maps to distress (NOT sadness):
  // High pitch + high energy modulation + broken speech (many short pauses) + unstable contour
  if (f.energyMod > 0.5 && f.pitch > 0.4) scores.distress += 0.3;
  if (f.energyMod > 0.4 && f.pauseCount > 2) scores.distress += 0.25;
  if (f.contour === "unstable") scores.distress += 0.2;
  if (f.pitchVariation > 0.4 && f.energy > 0.3 && f.energyMod > 0.3) scores.distress += 0.25;
  // Distinguish from anger: crying has high pitch variation, anger has low
  if (f.energy > 0.5 && f.pitch > 0.5 && f.pitchVariation > 0.35 && f.energyMod > 0.4) scores.distress += 0.2;

  // ── Laughter → maps to joy:
  // Very high ZCR + rapid energy modulation + mid-high pitch + moderate-high energy
  if (f.zcr > 0.3 && f.energyMod > 0.4) scores.joy += 0.3;
  if (f.zcr > 0.35 && f.energy > 0.4 && f.pitch > 0.4) scores.joy += 0.3;
  if (f.energyMod > 0.5 && f.pitchVariation > 0.3 && f.zcr > 0.25) scores.joy += 0.2;

  // ── Frustration: high energy + high pitch but moderate rate
  if (f.energy > 0.5 && f.pitch > 0.5 && f.rate >= 0.3 && f.rate < 0.6) scores.frustration += 0.4;
  if (f.energy > 0.4 && f.pitchVariation > 0.2 && f.pitchVariation < 0.4) scores.frustration += 0.2;

  // ── Confusion: frequent pauses + low energy + hesitation patterns
  if (f.pauseRatio > 0.3 && f.energy < 0.4) scores.confusion += 0.4;
  if (f.pauseRatio > 0.2 && f.rate < 0.4) scores.confusion += 0.2;
  if (f.contour === "rising") scores.confusion += 0.15; // Question intonation

  // ── Fear: moderate energy, high pitch, pauses, rising contour
  if (f.pauseRatio > 0.2 && f.energy > 0.3 && f.energy < 0.5 && f.pitch > 0.5) scores.fear += 0.35;
  if (f.contour === "rising" && f.pitch > 0.6) scores.fear += 0.2;
  if (f.rate > 0.6 && f.pitch > 0.6 && f.energy < 0.5) scores.fear += 0.15;

  // ── Distress (general): high energy + low pitch (deep groaning/distress sounds)
  if (f.energy > 0.5 && f.pitch < 0.3) scores.distress += 0.3;

  // ── Disappointment: low energy, slight falling contour, slow rate
  if (f.energy < 0.35 && f.rate < 0.4 && f.contour === "falling") scores.disappointment += 0.35;
  if (f.pitchVariation < 0.15 && f.energy < 0.3) scores.disappointment += 0.15;

  // ── Gratitude: warm and calm — moderate-low energy, unhurried pace, gentle
  // (not flat-monotone, not wildly variable) pitch, and a settling/falling
  // contour. The `energyMod`/`zcr` ceilings are the key discriminator against
  // laughter, which shares similar pitch/rate ranges but bursts rapidly —
  // sincere warmth doesn't. `pauseRatio < 0.2` discriminates against
  // confusion/hesitation, which shares the same quiet+slow range but is
  // halting rather than fluent. Without this, gratitude was unreachable from
  // audio alone (no rule ever added to its score), collapsing every warm/
  // positive-but-calm utterance into "neutral" or "joy".
  if (f.energy > 0.25 && f.energy < 0.55 && f.energyMod < 0.3 && f.pauseRatio < 0.2) scores.gratitude += 0.2;
  if (f.rate < 0.5 && f.zcr < 0.2 && f.pauseRatio < 0.2) scores.gratitude += 0.15;
  if (f.pitchVariation > 0.15 && f.pitchVariation < 0.4 && f.energyMod < 0.3 && f.pauseRatio < 0.2) scores.gratitude += 0.2;
  if ((f.contour === "falling" || f.contour === "flat") && f.zcr < 0.2 && f.pauseRatio < 0.2) scores.gratitude += 0.15;
  if (f.vad.v > 0.05 && f.energyMod < 0.25 && f.pauseRatio < 0.2) scores.gratitude += 0.15;

  // ── Calm: a genuine, actively-competing bucket for steady, unhurried,
  // low-arousal speech that isn't negative — the counterpart to the sadness
  // rules above. Before this, calm speech only avoided sadness (once the
  // sadness-bias fix required energy AND pitch both low) and fell through to
  // "neutral" by default rather than being positively recognized as its own
  // state. Deliberately does NOT require low pitch (that's sadness's
  // discriminator) — calm speech can be any comfortable pitch, what matters
  // is steadiness (low variation, low energy modulation) and an unhurried,
  // fluent pace (low pause ratio, not halting like confusion).
  if (f.energy > 0.15 && f.energy < 0.55 && f.pitchVariation < 0.25 && f.energyMod < 0.25) scores.calm += 0.3;
  if (f.pauseRatio < 0.15 && f.rate > 0.25 && f.rate < 0.6) scores.calm += 0.2;
  if ((f.contour === "flat" || f.contour === "falling") && f.zcr < 0.25) scores.calm += 0.15;
  if (f.vad.a < -0.2 && f.vad.v > -0.15) scores.calm += 0.15;

  // ── Neutral: low variation, moderate everything, no strong signals
  if (f.pitchVariation < 0.15 && f.vad.a < 0) scores.neutral += 0.3;
  if (f.energy > 0.2 && f.energy < 0.5 && f.rate > 0.3 && f.rate < 0.6) scores.neutral += 0.2;
  // Neutral gets a base score — it should win when nothing else is strong
  scores.neutral += 0.15;

  // ── Low-volume ambiguity: quiet speech is contextually consistent with
  // several negative/withdrawn states (subdued distress, fear, sadness,
  // confusion) but is NOT, on its own, evidence for any single one of them —
  // nudge all four candidates equally rather than asserting a specific label.
  if (f.quiet) {
    scores.sadness += 0.06;
    scores.fear += 0.06;
    scores.distress += 0.06;
    scores.confusion += 0.06;
  }

  // ── Manual sensitivity calibration ──────────────────────────────────────
  // Addresses the documented tendency of DSP-heuristic acoustic scoring to
  // over-read ambiguous/quiet audio as negative. A real scoring adjustment
  // (not a post-hoc relabel), so it can flip which label wins on borderline
  // cases — e.g. a positive bias can be the difference between "sadness" and
  // "calm" for the exact same audio, not just a cosmetic VAD shift.
  if (f.sensitivityBias !== 0) {
    const BIAS_STRENGTH = 0.4; // scoring nudge at full ±1 bias
    const delta = f.sensitivityBias * BIAS_STRENGTH;
    for (const l of POSITIVE_LABELS) scores[l] += delta;
    for (const l of NEGATIVE_LABELS) scores[l] -= delta;
  }

  // ── Find winner ─────────────────────────────────────────────────────────
  let bestLabel: EmotionLabel = "neutral";
  let bestScore = 0;
  let secondBestScore = 0;

  for (const [lbl, score] of Object.entries(scores) as [EmotionLabel, number][]) {
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestLabel = lbl;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  // Pattern strength: how much the winner stands out from runner-up (0-1)
  const patternStrength = bestScore > 0
    ? clamp((bestScore - secondBestScore) / bestScore, 0, 1)
    : 0;

  // Surface which specific acoustic pattern drove a distress/joy result, so
  // the UI can show "crying" / "laughing" instead of just the mapped label.
  let signalHint: "crying" | "laughing" | undefined;
  if (bestLabel === "distress" && f.energyMod > 0.4 && f.pitch > 0.4) {
    signalHint = "crying";
  } else if (bestLabel === "joy" && f.zcr > 0.3 && f.energyMod > 0.4) {
    signalHint = "laughing";
  }

  // A voice carries arousal and valence, not meaning: it cannot tell gratitude from calm, disappointment
  // from sadness. Name the nearest acoustic class and leave the specific
  // label to the words (fusion lets the text label win when the words are clear).
  const ACOUSTIC_NEIGHBOUR: Partial<Record<EmotionLabel, EmotionLabel>> = {
    gratitude: "calm",
    disappointment: "sadness",
  };
  bestLabel = ACOUSTIC_NEIGHBOUR[bestLabel] ?? bestLabel;

  return { label: bestLabel, patternStrength, signalHint };
}
