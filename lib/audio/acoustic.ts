/**
 * Acoustic Feature Extraction — Pure-JS DSP on linear16 PCM buffers.
 *
 * All computations operate directly on 16-bit signed integer PCM samples
 * via Buffer.readInt16LE(). No FFT libraries, no native bindings.
 *
 * Designed for 8kHz mono telephony audio (Twilio → Deepgram pipeline).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

import type { AcousticFeatures } from "../types";
import { CONFIG } from "../config";
export type { AcousticFeatures };

// ─── Constants ──────────────────────────────────────────────────────────────

const SAMPLE_RATE = 8000;
const FRAME_SIZE = 160;          // 20ms frames at 8kHz
const FRAME_STEP = 80;           // 50% overlap (10ms step)
const MIN_PITCH_HZ = 70;        // Lowest F0 to search for
const MAX_PITCH_HZ = 400;       // Highest F0 to search for
const MIN_PITCH_LAG = Math.floor(SAMPLE_RATE / MAX_PITCH_HZ);  // ~20 samples
const MAX_PITCH_LAG = Math.floor(SAMPLE_RATE / MIN_PITCH_HZ);  // ~114 samples

/**
 * Silence threshold for pause detection (16-bit amplitude). Was a hardcoded
 * local constant duplicating (and drifting from) CONFIG.telephony
 * .silenceEnergyThreshold, which nothing actually read — now the single
 * source of truth, so raising the noise floor in config actually changes
 * behavior here instead of silently doing nothing.
 */
const PAUSE_ENERGY_THRESHOLD = CONFIG.telephony.silenceEnergyThreshold;
/** Minimum silence duration (ms) to count as a pause. */
const MIN_PAUSE_MS = 300;
const MIN_PAUSE_SAMPLES = Math.floor((MIN_PAUSE_MS / 1000) * SAMPLE_RATE);

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Convert RMS amplitude (0–32768 for 16-bit PCM) to dBFS (full-scale decibels).
 * ~0 = clipping, more negative = quieter, clamped at -60 for near-silence.
 */
export function computeDecibels(rmsEnergy: number): number {
  if (rmsEnergy <= 0) return -60;
  const db = 20 * Math.log10(rmsEnergy / 32768);
  return Math.max(-60, db);
}

/**
 * Compute RMS energy of a PCM buffer. Used for barge-in threshold checks.
 * Returns a value in the 0–32768 range for 16-bit audio.
 */
export function computeRmsEnergy(pcm: Buffer): number {
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount === 0) return 0;

  let sumSq = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = pcm.readInt16LE(i * 2);
    sumSq += sample * sample;
  }
  return Math.sqrt(sumSq / sampleCount);
}

/**
 * Zero-crossing rate (0-1) of a single small PCM buffer — e.g. one 20ms
 * Twilio media frame — for real-time barge-in gating. Cheap enough to run
 * per-frame (no sub-framing/averaging, unlike extractAcousticFeatures'
 * turn-level version): human speech has a moderate, textured ZCR, while
 * steady background noise tends to sit at an extreme — a near-DC hum stays
 * close to 0, broadband static/hiss stays close to 1. Used alongside RMS so
 * a barge-in only fires for sound that's both loud AND speech-shaped,
 * instead of loud alone (which line noise/static can also be).
 */
export function computeFrameZeroCrossingRate(pcm: Buffer): number {
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount < 2) return 0;
  let crossings = 0;
  let prev = pcm.readInt16LE(0);
  for (let i = 1; i < sampleCount; i++) {
    const sample = pcm.readInt16LE(i * 2);
    if ((sample >= 0 && prev < 0) || (sample < 0 && prev >= 0)) crossings++;
    prev = sample;
  }
  return crossings / (sampleCount - 1);
}

/**
 * Extract full acoustic features from a completed speech turn's PCM buffer.
 *
 * @param pcm - Concatenated linear16 PCM buffer for the entire turn
 * @param wordCount - Number of words in the transcript (for speaking rate)
 */
export function extractAcousticFeatures(pcm: Buffer, wordCount: number): AcousticFeatures {
  const sampleCount = Math.floor(pcm.length / 2);
  const durationMs = (sampleCount / SAMPLE_RATE) * 1000;

  if (sampleCount < FRAME_SIZE) {
    const rms = computeRmsEnergy(pcm);
    return {
      rmsEnergy: rms,
      zeroCrossingRate: 0,
      pitchHz: 0,
      pitchVariation: 0,
      speakingRateWPM: 0,
      pauseDurationMs: 0,
      pauseCount: 0,
      durationMs,
      decibels: computeDecibels(rms),
    };
  }

  // Global RMS
  const rmsEnergy = computeRmsEnergy(pcm);

  // Frame-level analysis
  const framePitches: number[] = [];
  let totalZcr = 0;
  let frameCount = 0;

  for (let offset = 0; offset + FRAME_SIZE <= sampleCount; offset += FRAME_STEP) {
    const frameSamples = readSamples(pcm, offset, FRAME_SIZE);

    // ZCR for this frame
    totalZcr += computeFrameZCR(frameSamples);
    frameCount++;

    // Pitch estimation via autocorrelation
    const pitch = estimateFramePitch(frameSamples);
    if (pitch > 0) {
      framePitches.push(pitch);
    }
  }

  const zeroCrossingRate = frameCount > 0 ? totalZcr / frameCount : 0;

  // Pitch statistics — sort a copy for median/variance so the original
  // chronological order survives for contour direction detection below.
  let pitchHz = 0;
  let pitchVariation = 0;
  if (framePitches.length > 0) {
    const sortedPitches = [...framePitches].sort((a, b) => a - b);
    pitchHz = sortedPitches[Math.floor(sortedPitches.length / 2)]; // median

    const mean = sortedPitches.reduce((s, p) => s + p, 0) / sortedPitches.length;
    const variance = sortedPitches.reduce((s, p) => s + (p - mean) ** 2, 0) / sortedPitches.length;
    const stddev = Math.sqrt(variance);
    pitchVariation = mean > 0 ? Math.min(1, stddev / mean) : 0;
  }

  // Speaking rate
  const durationSec = durationMs / 1000;
  const speakingRateWPM = durationSec > 0 ? (wordCount / durationSec) * 60 : 0;

  // Pause detection
  const { pauseDurationMs, pauseCount } = detectPauses(pcm, sampleCount);

  // Energy modulation rate: measures how rapidly energy changes between frames.
  // High values indicate rapid amplitude oscillation (crying, laughter, sobs).
  const energyModulationRate = computeEnergyModulation(pcm, sampleCount);

  // Pitch contour: overall direction of pitch across the utterance
  const pitchContour = computePitchContour(framePitches);

  return {
    rmsEnergy,
    zeroCrossingRate,
    pitchHz,
    pitchVariation,
    speakingRateWPM,
    pauseDurationMs,
    pauseCount,
    durationMs,
    energyModulationRate,
    pitchContour,
    decibels: computeDecibels(rmsEnergy),
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/** Read a slice of PCM samples into a number array. */
function readSamples(pcm: Buffer, startSample: number, count: number): number[] {
  const samples: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    samples[i] = pcm.readInt16LE((startSample + i) * 2);
  }
  return samples;
}

/** Compute zero-crossing rate for a frame (0–1). */
function computeFrameZCR(samples: number[]): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) {
      crossings++;
    }
  }
  return crossings / (samples.length - 1);
}

/**
 * Estimate fundamental frequency (F0) using autocorrelation.
 * Returns pitch in Hz, or 0 if the frame is unvoiced.
 */
function estimateFramePitch(samples: number[]): number {
  const n = samples.length;

  // Pre-compute the frame energy for normalized correlation threshold
  let energy = 0;
  for (let i = 0; i < n; i++) {
    energy += samples[i] * samples[i];
  }
  if (energy < 1e6) return 0; // Too quiet — treat as silence/unvoiced

  const effectiveMaxLag = Math.min(MAX_PITCH_LAG, n - 1);
  if (MIN_PITCH_LAG >= effectiveMaxLag) return 0;

  // Autocorrelation for lags in the pitch range
  let bestCorrelation = -1;
  let bestLag = 0;

  // Compute R(0) for normalization
  let r0 = 0;
  for (let i = 0; i < n; i++) {
    r0 += samples[i] * samples[i];
  }

  for (let lag = MIN_PITCH_LAG; lag <= effectiveMaxLag; lag++) {
    let correlation = 0;
    let denomEnergy = 0;
    for (let i = 0; i < n - lag; i++) {
      correlation += samples[i] * samples[i + lag];
      denomEnergy += samples[i + lag] * samples[i + lag];
    }

    // Normalized correlation
    const denom = Math.sqrt(r0 * denomEnergy);
    const normalized = denom > 0 ? correlation / denom : 0;

    if (normalized > bestCorrelation) {
      bestCorrelation = normalized;
      bestLag = lag;
    }
  }

  // Require a minimum correlation threshold for voiced speech
  if (bestCorrelation < 0.3 || bestLag === 0) return 0;

  return SAMPLE_RATE / bestLag;
}

/**
 * Detect pauses (silence segments) in the PCM buffer.
 * A pause is a contiguous region where RMS energy stays below threshold
 * for at least MIN_PAUSE_MS.
 */
function detectPauses(pcm: Buffer, sampleCount: number): { pauseDurationMs: number; pauseCount: number } {
  let pauseCount = 0;
  let totalPauseSamples = 0;
  let silenceRun = 0;

  // Scan in small windows (10ms = 80 samples at 8kHz)
  const windowSize = 80;

  for (let offset = 0; offset + windowSize <= sampleCount; offset += windowSize) {
    let sumSq = 0;
    for (let i = 0; i < windowSize; i++) {
      const sample = pcm.readInt16LE((offset + i) * 2);
      sumSq += sample * sample;
    }
    const windowRms = Math.sqrt(sumSq / windowSize);

    if (windowRms < PAUSE_ENERGY_THRESHOLD) {
      silenceRun += windowSize;
    } else {
      if (silenceRun >= MIN_PAUSE_SAMPLES) {
        pauseCount++;
        totalPauseSamples += silenceRun;
      }
      silenceRun = 0;
    }
  }

  // Handle trailing silence
  if (silenceRun >= MIN_PAUSE_SAMPLES) {
    pauseCount++;
    totalPauseSamples += silenceRun;
  }

  const pauseDurationMs = (totalPauseSamples / SAMPLE_RATE) * 1000;
  return { pauseDurationMs, pauseCount };
}

/**
 * Compute energy modulation rate — how rapidly amplitude changes between frames.
 * High values indicate rapid oscillation (crying sobs, laughter bursts).
 * Returns a value in 0–1 range.
 */
function computeEnergyModulation(pcm: Buffer, sampleCount: number): number {
  const windowSize = FRAME_SIZE; // 20ms windows
  const energies: number[] = [];

  for (let offset = 0; offset + windowSize <= sampleCount; offset += windowSize) {
    let sumSq = 0;
    for (let i = 0; i < windowSize; i++) {
      const sample = pcm.readInt16LE((offset + i) * 2);
      sumSq += sample * sample;
    }
    energies.push(Math.sqrt(sumSq / windowSize));
  }

  if (energies.length < 3) return 0;

  // Compute mean absolute difference between consecutive frame energies
  let totalDiff = 0;
  for (let i = 1; i < energies.length; i++) {
    totalDiff += Math.abs(energies[i] - energies[i - 1]);
  }
  const meanDiff = totalDiff / (energies.length - 1);

  // Normalize: typical speech has meanDiff ~200-800, high modulation >1500
  return Math.min(1, meanDiff / 2000);
}

/**
 * Determine overall pitch contour direction using simple linear regression.
 * Returns "rising", "falling", "flat", or "unstable".
 */
function computePitchContour(framePitches: number[]): "rising" | "falling" | "flat" | "unstable" {
  if (framePitches.length < 3) return "flat";

  const n = framePitches.length;
  const mean = framePitches.reduce((s, p) => s + p, 0) / n;

  // Simple linear regression: y = mx + b
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i - (n - 1) / 2; // center the x values
    sumXY += x * (framePitches[i] - mean);
    sumX2 += x * x;
  }
  const slope = sumX2 > 0 ? sumXY / sumX2 : 0;

  // Normalize slope relative to mean pitch
  const normalizedSlope = mean > 0 ? slope / mean : 0;

  // Check for instability (high coefficient of variation)
  const variance = framePitches.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  if (cv > 0.4) return "unstable"; // Very erratic pitch = emotional instability
  if (normalizedSlope > 0.003) return "rising";
  if (normalizedSlope < -0.003) return "falling";
  return "flat";
}
