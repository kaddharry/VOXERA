/**
 * Acoustic Feature Extraction — Pure-JS DSP on linear16 PCM buffers.
 *
 * All computations operate directly on 16-bit signed integer PCM samples
 * via Buffer.readInt16LE(). No FFT libraries, no native bindings.
 *
 * Designed for 8kHz mono telephony audio (Twilio → Deepgram pipeline).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AcousticFeatures {
  /** Root-mean-square amplitude (0–32768 range for 16-bit PCM). */
  rmsEnergy: number;
  /** Zero-crossing rate: fraction of adjacent samples that cross zero (0–1). */
  zeroCrossingRate: number;
  /** Estimated fundamental frequency in Hz (median across frames). 0 if unvoiced. */
  pitchHz: number;
  /** Pitch coefficient of variation (stddev / mean). Higher = more dynamic. 0–1 clamped. */
  pitchVariation: number;
  /** Estimated words-per-minute based on transcript word count and audio duration. */
  speakingRateWPM: number;
  /** Total detected silence/pause duration in ms. */
  pauseDurationMs: number;
  /** Number of distinct pause segments detected. */
  pauseCount: number;
  /** Total audio duration in ms. */
  durationMs: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SAMPLE_RATE = 8000;
const FRAME_SIZE = 160;          // 20ms frames at 8kHz
const FRAME_STEP = 80;           // 50% overlap (10ms step)
const MIN_PITCH_HZ = 70;        // Lowest F0 to search for
const MAX_PITCH_HZ = 400;       // Highest F0 to search for
const MIN_PITCH_LAG = Math.floor(SAMPLE_RATE / MAX_PITCH_HZ);  // ~20 samples
const MAX_PITCH_LAG = Math.floor(SAMPLE_RATE / MIN_PITCH_HZ);  // ~114 samples

/** Silence threshold for pause detection (16-bit amplitude). */
const PAUSE_ENERGY_THRESHOLD = 200;
/** Minimum silence duration (ms) to count as a pause. */
const MIN_PAUSE_MS = 300;
const MIN_PAUSE_SAMPLES = Math.floor((MIN_PAUSE_MS / 1000) * SAMPLE_RATE);

// ─── Public API ─────────────────────────────────────────────────────────────

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
 * Extract full acoustic features from a completed speech turn's PCM buffer.
 *
 * @param pcm - Concatenated linear16 PCM buffer for the entire turn
 * @param wordCount - Number of words in the transcript (for speaking rate)
 */
export function extractAcousticFeatures(pcm: Buffer, wordCount: number): AcousticFeatures {
  const sampleCount = Math.floor(pcm.length / 2);
  const durationMs = (sampleCount / SAMPLE_RATE) * 1000;

  if (sampleCount < FRAME_SIZE) {
    return {
      rmsEnergy: computeRmsEnergy(pcm),
      zeroCrossingRate: 0,
      pitchHz: 0,
      pitchVariation: 0,
      speakingRateWPM: 0,
      pauseDurationMs: 0,
      pauseCount: 0,
      durationMs,
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

  // Pitch statistics
  let pitchHz = 0;
  let pitchVariation = 0;
  if (framePitches.length > 0) {
    framePitches.sort((a, b) => a - b);
    pitchHz = framePitches[Math.floor(framePitches.length / 2)]; // median

    const mean = framePitches.reduce((s, p) => s + p, 0) / framePitches.length;
    const variance = framePitches.reduce((s, p) => s + (p - mean) ** 2, 0) / framePitches.length;
    const stddev = Math.sqrt(variance);
    pitchVariation = mean > 0 ? Math.min(1, stddev / mean) : 0;
  }

  // Speaking rate
  const durationSec = durationMs / 1000;
  const speakingRateWPM = durationSec > 0 ? (wordCount / durationSec) * 60 : 0;

  // Pause detection
  const { pauseDurationMs, pauseCount } = detectPauses(pcm, sampleCount);

  return {
    rmsEnergy,
    zeroCrossingRate,
    pitchHz,
    pitchVariation,
    speakingRateWPM,
    pauseDurationMs,
    pauseCount,
    durationMs,
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
