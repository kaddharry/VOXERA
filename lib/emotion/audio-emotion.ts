/**
 * Acoustic Emotion Analysis — Maps acoustic features to EmotionSignal.
 *
 * Replaces the previous `detectAudioEmotionStub()`. Uses physical acoustic
 * measurements (pitch, energy, rate, pauses) to infer caller emotion from
 * the audio stream, independent of transcript text.
 *
 * The resulting EmotionSignal (source: "audio") is fused with the text-based
 * signal via the existing `fuseEmotion()` function in detect.ts.
 */

import type { AcousticFeatures, EmotionLabel, EmotionSignal, VAD } from "../types";
import { clamp } from "../util/math";
import { classifyConfidence } from "./confidence";

/**
 * Derive an EmotionSignal from physical acoustic features.
 *
 * Heuristic mapping (based on speech emotion research):
 * - High energy + high pitch → anger or excitement (disambiguated by rate)
 * - Low energy + low pitch + slow rate → sadness
 * - High pitch variation → engagement / excitement
 * - Monotone (low variation) → neutral or sadness
 * - Frequent pauses → confusion / hesitation
 * - Fast rate + high energy → excitement or anger
 *
 * Confidence scales with audio duration: <2s = low confidence (0.3),
 * 2-5s = medium (0.5), >5s = high (0.65+).
 */
export function detectAudioEmotion(features: AcousticFeatures): EmotionSignal | null {
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

  // ─── VAD computation from acoustic features ────────────────────────────

  // Valence: harder to determine from audio alone. Use rate + pitch variation
  // as weak proxies. Fast + varied = likely positive; slow + monotone = likely negative.
  let valence = 0;
  valence += (features.pitchVariation - 0.3) * 0.6;   // High variation → positive
  valence += (rateNorm - 0.5) * 0.3;                   // Fast → slightly positive
  valence -= pauseRatio * 0.3;                          // Pauses → slightly negative
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

  // ─── Label inference ──────────────────────────────────────────────────

  const label = inferLabel(energyNorm, pitchNorm, features.pitchVariation, rateNorm, pauseRatio, vad);

  // ─── Confidence based on audio duration ────────────────────────────────
  // Longer audio → more reliable acoustic analysis
  let confidence: number;
  if (features.durationMs < 2000) {
    confidence = 0.3;  // Very short — low confidence
  } else if (features.durationMs < 5000) {
    confidence = 0.45 + (features.durationMs - 2000) / 15000; // 0.45–0.65
  } else {
    confidence = Math.min(0.75, 0.65 + (features.durationMs - 5000) / 50000);
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
  };
}

/**
 * Map normalized acoustic features to an emotion label.
 */
function inferLabel(
  energy: number,
  pitch: number,
  pitchVariation: number,
  rate: number,
  pauseRatio: number,
  vad: VAD,
): EmotionLabel {
  // High energy + high pitch + fast rate → anger or excitement
  if (energy > 0.6 && pitch > 0.5 && rate > 0.6) {
    // Disambiguate: high pitch variation = excitement, low = anger
    return pitchVariation > 0.4 ? "excitement" : "anger";
  }

  // High energy + high pitch but moderate rate → frustration
  if (energy > 0.5 && pitch > 0.5 && rate >= 0.4) {
    return "frustration";
  }

  // Low energy + low pitch + slow rate → sadness
  if (energy < 0.3 && pitch < 0.4 && rate < 0.4) {
    return "sadness";
  }

  // Frequent pauses + low energy → confusion
  if (pauseRatio > 0.3 && energy < 0.4) {
    return "confusion";
  }

  // High pitch variation + moderate-high energy → excitement
  if (pitchVariation > 0.5 && energy > 0.4) {
    return "excitement";
  }

  // Low pitch variation (monotone) + low arousal → neutral or disengagement
  if (pitchVariation < 0.15 && vad.a < 0) {
    return "neutral";
  }

  // Moderate energy + some pauses → fear/hesitation
  if (pauseRatio > 0.2 && energy > 0.3 && energy < 0.5 && pitch > 0.5) {
    return "fear";
  }

  // High energy + low pitch → distress
  if (energy > 0.5 && pitch < 0.3) {
    return "distress";
  }

  return "neutral";
}
