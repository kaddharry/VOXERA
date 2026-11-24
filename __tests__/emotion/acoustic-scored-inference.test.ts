import { describe, it, expect } from "vitest";
import { extractAcousticFeatures } from "../../lib/audio/acoustic";
import { detectAudioEmotion } from "../../lib/emotion/audio-emotion";
import type { AcousticFeatures } from "../../lib/types";

const SAMPLE_RATE = 8000;

/** Sine tone with an amplitude envelope that alternates every `burstMs` (simulates broken/sobbing speech or laughter bursts). */
function generateModulatedPCM(freqHz: number, durationMs: number, burstMs: number, highAmp: number, lowAmp: number): Buffer {
  const sampleCount = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const pcm = Buffer.alloc(sampleCount * 2);
  const burstSamples = Math.floor((burstMs / 1000) * SAMPLE_RATE);
  for (let i = 0; i < sampleCount; i++) {
    const inHighBurst = Math.floor(i / burstSamples) % 2 === 0;
    const amp = inHighBurst ? highAmp : lowAmp;
    const sample = Math.round(amp * Math.sin((2 * Math.PI * freqHz * i) / SAMPLE_RATE));
    pcm.writeInt16LE(sample, i * 2);
  }
  return pcm;
}

/** Sine tone that sweeps frequency linearly from startHz to endHz (chirp) — for pitch contour detection. */
function generateChirpPCM(startHz: number, endHz: number, durationMs: number, amplitude = 8000): Buffer {
  const sampleCount = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const pcm = Buffer.alloc(sampleCount * 2);
  let phase = 0;
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;
    const freq = startHz + (endHz - startHz) * t;
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    pcm.writeInt16LE(Math.round(amplitude * Math.sin(phase)), i * 2);
  }
  return pcm;
}

function generateSteadyPCM(freqHz: number, durationMs: number, amplitude = 6000): Buffer {
  const sampleCount = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    pcm.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * freqHz * i) / SAMPLE_RATE)), i * 2);
  }
  return pcm;
}

describe("Issue #28: Upgraded acoustic emotion engine", () => {
  describe("Feature extraction — energyModulationRate", () => {
    it("is high for rapidly alternating amplitude bursts (crying/laughter-like)", () => {
      const modulated = generateModulatedPCM(220, 3000, 40, 15000, 200);
      const features = extractAcousticFeatures(modulated, 5);
      expect(features.energyModulationRate).toBeDefined();
      expect(features.energyModulationRate!).toBeGreaterThan(0.3);
    });

    it("is low for a steady, constant-amplitude tone", () => {
      const steady = generateSteadyPCM(200, 3000);
      const features = extractAcousticFeatures(steady, 5);
      expect(features.energyModulationRate).toBeDefined();
      expect(features.energyModulationRate!).toBeLessThan(0.3);
    });
  });

  describe("Feature extraction — pitchContour", () => {
    it("detects a rising contour from an ascending frequency sweep", () => {
      const chirp = generateChirpPCM(120, 320, 3000);
      const features = extractAcousticFeatures(chirp, 5);
      expect(features.pitchContour).toBe("rising");
    });

    it("detects a falling contour from a descending frequency sweep", () => {
      const chirp = generateChirpPCM(320, 120, 3000);
      const features = extractAcousticFeatures(chirp, 5);
      expect(features.pitchContour).toBe("falling");
    });

    it("detects a flat contour from a constant-frequency tone", () => {
      const steady = generateSteadyPCM(200, 3000);
      const features = extractAcousticFeatures(steady, 5);
      expect(features.pitchContour).toBe("flat");
    });
  });

  describe("Crying/sobbing detection (maps to distress)", () => {
    it("classifies a crying pattern (high pitch + high energy modulation + broken pauses + unstable contour) as distress, not anger or excitement", () => {
      const features: AcousticFeatures = {
        rmsEnergy: 3800,
        zeroCrossingRate: 0.12,
        pitchHz: 320,
        pitchVariation: 0.55,
        speakingRateWPM: 90,
        pauseDurationMs: 900,
        pauseCount: 5, // broken speech — frequent short pauses
        durationMs: 6000,
        energyModulationRate: 0.65,
        pitchContour: "unstable",
      };
      const emotion = detectAudioEmotion(features);
      expect(emotion).not.toBeNull();
      expect(emotion!.label).toBe("distress");
    });

    it("does not misclassify a controlled, monotone angry voice as distress", () => {
      const features: AcousticFeatures = {
        rmsEnergy: 4500,
        zeroCrossingRate: 0.15,
        pitchHz: 300,
        pitchVariation: 0.15, // low variation — controlled rage, not crying
        speakingRateWPM: 170,
        pauseDurationMs: 50,
        pauseCount: 0,
        durationMs: 5000,
        energyModulationRate: 0.1, // steady, not bursty
        pitchContour: "flat",
      };
      const emotion = detectAudioEmotion(features);
      expect(emotion).not.toBeNull();
      expect(emotion!.label).toBe("anger");
    });
  });

  describe("Laughter detection (maps to joy)", () => {
    it("classifies a laughter pattern (high ZCR + rapid energy modulation + mid-high pitch) as joy", () => {
      const features: AcousticFeatures = {
        rmsEnergy: 2300, // moderate energy — avoids tripping the anger/frustration high-energy rules
        zeroCrossingRate: 0.4, // very high ZCR
        pitchHz: 220,
        pitchVariation: 0.35,
        speakingRateWPM: 130,
        pauseDurationMs: 0,
        pauseCount: 0, // laughter bursts, not broken/sobbing speech
        durationMs: 4000,
        energyModulationRate: 0.6, // rapid bursts
        pitchContour: "flat",
      };
      const emotion = detectAudioEmotion(features);
      expect(emotion).not.toBeNull();
      expect(emotion!.label).toBe("joy");
    });
  });

  describe("Validation scenario from Issue #28 — voice signal independent of words", () => {
    it("interprets a crying child's voice as distress with high emotional significance, regardless of neutral wording", () => {
      // "pencil lost" — text is neutral/simple, but the *voice* is crying.
      const cryingVoice: AcousticFeatures = {
        rmsEnergy: 3600,
        zeroCrossingRate: 0.1,
        pitchHz: 350, // children have naturally higher pitch, elevated further by crying
        pitchVariation: 0.6,
        speakingRateWPM: 70, // slow, broken delivery
        pauseDurationMs: 1200,
        pauseCount: 4,
        durationMs: 5000,
        energyModulationRate: 0.7,
        pitchContour: "unstable",
      };
      const emotion = detectAudioEmotion(cryingVoice);
      expect(emotion).not.toBeNull();
      expect(emotion!.label).toBe("distress");
      expect(emotion!.intensity).toBeGreaterThan(0.3);
    });
  });

  describe("Recalibrated confidence ceiling (~0.85 for long, clear utterances)", () => {
    it("does not artificially inflate confidence for short, ambiguous audio", () => {
      const shortFeatures: AcousticFeatures = {
        rmsEnergy: 3000, zeroCrossingRate: 0.1, pitchHz: 200,
        pitchVariation: 0.3, speakingRateWPM: 140, pauseDurationMs: 0,
        pauseCount: 0, durationMs: 1500,
      };
      const emotion = detectAudioEmotion(shortFeatures);
      expect(emotion).not.toBeNull();
      expect(emotion!.confidence).toBeLessThanOrEqual(0.3);
    });

    it("allows confidence to approach ~0.85 for a long utterance with a clear, distinctive pattern", () => {
      const longClearFeatures: AcousticFeatures = {
        rmsEnergy: 4500,
        zeroCrossingRate: 0.15,
        pitchHz: 300,
        pitchVariation: 0.15,
        speakingRateWPM: 170,
        pauseDurationMs: 50,
        pauseCount: 0,
        durationMs: 12000, // long, clear anger pattern
        energyModulationRate: 0.1,
        pitchContour: "flat",
      };
      const emotion = detectAudioEmotion(longClearFeatures);
      expect(emotion).not.toBeNull();
      expect(emotion!.confidence).toBeGreaterThan(0.75);
      expect(emotion!.confidence).toBeLessThanOrEqual(0.85);
    });
  });

  describe("Issue: acoustic emotion coverage was imbalanced (5 reachable labels, gratitude dead)", () => {
    it("reads a warm, calm, sincere voice as calm (a voice alone cannot name gratitude; the words do that)", () => {
      const warmVoice: AcousticFeatures = {
        rmsEnergy: 2200, // moderate-low energy
        zeroCrossingRate: 0.1, // low ZCR — distinguishes from laughter
        pitchHz: 190,
        pitchVariation: 0.25, // gentle, not flat, not wild
        speakingRateWPM: 100, // unhurried
        pauseDurationMs: 200,
        pauseCount: 1,
        durationMs: 4000,
        energyModulationRate: 0.1, // steady — distinguishes from laughter's bursts
        pitchContour: "falling", // settling, sincere tone
      };
      const emotion = detectAudioEmotion(warmVoice);
      expect(emotion).not.toBeNull();
      expect(emotion!.label).toBe("calm");
    });

    it("still classifies laughter as joy, not gratitude, despite overlapping pitch/rate ranges", () => {
      const laughter: AcousticFeatures = {
        rmsEnergy: 2300,
        zeroCrossingRate: 0.4,
        pitchHz: 220,
        pitchVariation: 0.35,
        speakingRateWPM: 130,
        pauseDurationMs: 0,
        pauseCount: 0,
        durationMs: 4000,
        energyModulationRate: 0.6,
        pitchContour: "flat",
      };
      const emotion = detectAudioEmotion(laughter);
      expect(emotion).not.toBeNull();
      expect(emotion!.label).toBe("joy");
      expect((emotion as any).acousticSignalHint).toBe("laughing");
    });

    it("tags a crying pattern with the acousticSignalHint 'crying'", () => {
      const cryingVoice: AcousticFeatures = {
        rmsEnergy: 3800,
        zeroCrossingRate: 0.12,
        pitchHz: 320,
        pitchVariation: 0.55,
        speakingRateWPM: 90,
        pauseDurationMs: 900,
        pauseCount: 5,
        durationMs: 6000,
        energyModulationRate: 0.65,
        pitchContour: "unstable",
      };
      const emotion = detectAudioEmotion(cryingVoice);
      expect(emotion).not.toBeNull();
      expect(emotion!.label).toBe("distress");
      expect((emotion as any).acousticSignalHint).toBe("crying");
    });

    it("does not let very quiet speech deterministically map to one label — it nudges several subdued candidates instead", () => {
      const quietVoice: AcousticFeatures = {
        rmsEnergy: 400, // very quiet — energyNorm ~0.08, below the 0.15 "quiet" threshold
        zeroCrossingRate: 0.08,
        pitchHz: 150,
        pitchVariation: 0.2,
        speakingRateWPM: 90,
        pauseDurationMs: 300,
        pauseCount: 1,
        durationMs: 4000,
      };
      const emotion = detectAudioEmotion(quietVoice);
      expect(emotion).not.toBeNull();
      // Should land on one of the plausible "subdued" states, not a hard assertion
      // of a single deterministic label — this test only pins the *behavior*
      // (no crash, a real signal-derived label) rather than a specific winner.
      expect(["sadness", "fear", "distress", "confusion", "neutral"]).toContain(emotion!.label);
    });
  });

  describe("Sadness bias regression — calm/neutral/positive speech must not default to sadness", () => {
    it("does not classify moderate-energy, unhurried, calm speech as sadness (was the reported live-testing bug)", () => {
      const calmNeutral: AcousticFeatures = {
        rmsEnergy: 2200,
        zeroCrossingRate: 0.12,
        pitchHz: 190,
        pitchVariation: 0.22,
        speakingRateWPM: 105,
        pauseDurationMs: 150,
        pauseCount: 1,
        durationMs: 4000,
        energyModulationRate: 0.15,
        pitchContour: "falling", // ordinary declarative sentences end falling — not sadness-specific
      };
      const emotion = detectAudioEmotion(calmNeutral);
      expect(emotion).not.toBeNull();
      expect(emotion!.label).not.toBe("sadness");
    });

    it("does not classify a calm, positive (warm-toned) voice as sadness just because it's quiet-ish", () => {
      const warmVoice: AcousticFeatures = {
        rmsEnergy: 2200,
        zeroCrossingRate: 0.1,
        pitchHz: 190,
        pitchVariation: 0.25,
        speakingRateWPM: 100,
        pauseDurationMs: 200,
        pauseCount: 1,
        durationMs: 4000,
        energyModulationRate: 0.1,
        pitchContour: "falling",
      };
      const emotion = detectAudioEmotion(warmVoice);
      expect(emotion).not.toBeNull();
      expect(emotion!.label).toBe("calm");
    });

    it("still reaches sadness for a genuinely low energy AND low pitch voice, not just a quiet one", () => {
      const genuinelySad: AcousticFeatures = {
        rmsEnergy: 900, // energyNorm ~0.18 — quiet, but the discriminator is pitch too
        zeroCrossingRate: 0.08,
        pitchHz: 100, // pitchNorm ~0.09 — genuinely low, not just moderate
        pitchVariation: 0.1,
        speakingRateWPM: 70,
        pauseDurationMs: 400,
        pauseCount: 2,
        durationMs: 5000,
        energyModulationRate: 0.05,
        pitchContour: "falling",
      };
      const emotion = detectAudioEmotion(genuinelySad);
      expect(emotion).not.toBeNull();
      expect(emotion!.label).toBe("sadness");
    });
  });

  describe("sensitivity calibration — manual bias knob for the acoustic engine's negative-read tendency", () => {
    it("does nothing at bias=0 (default, unchanged behavior)", () => {
      const sad: AcousticFeatures = {
        rmsEnergy: 900, zeroCrossingRate: 0.08, pitchHz: 100, pitchVariation: 0.1,
        speakingRateWPM: 70, pauseDurationMs: 400, pauseCount: 2, durationMs: 5000,
        energyModulationRate: 0.05, pitchContour: "falling",
      };
      const noOpts = detectAudioEmotion(sad);
      const zeroBias = detectAudioEmotion(sad, { sensitivityBias: 0 });
      expect(zeroBias?.label).toBe(noOpts?.label);
    });

    it("a positive bias can flip a borderline sadness read to calm — a real scoring effect, not cosmetic", () => {
      // Deliberately borderline: mild-low energy/pitch, close to (but not
      // over) the sadness threshold, so a scoring nudge can tip it either way.
      const borderline: AcousticFeatures = {
        rmsEnergy: 1150, zeroCrossingRate: 0.15, pitchHz: 168, pitchVariation: 0.13,
        speakingRateWPM: 95, pauseDurationMs: 100, pauseCount: 1, durationMs: 4000,
        energyModulationRate: 0.15, pitchContour: "falling",
      };
      const unbiased = detectAudioEmotion(borderline);
      expect(unbiased?.label).toBe("sadness");

      const positivelyBiased = detectAudioEmotion(borderline, { sensitivityBias: 1 });
      expect(positivelyBiased?.label).toBe("calm");
    });

    it("clamps out-of-range bias values instead of over/under-shooting", () => {
      const borderline: AcousticFeatures = {
        rmsEnergy: 1150, zeroCrossingRate: 0.15, pitchHz: 168, pitchVariation: 0.13,
        speakingRateWPM: 95, pauseDurationMs: 100, pauseCount: 1, durationMs: 4000,
        energyModulationRate: 0.15, pitchContour: "falling",
      };
      const clampedHigh = detectAudioEmotion(borderline, { sensitivityBias: 5 });
      const atMax = detectAudioEmotion(borderline, { sensitivityBias: 1 });
      expect(clampedHigh?.label).toBe(atMax?.label);
    });
  });

  describe("calm — a real, actively-competing bucket (Ticket 3), not just an escape hatch from sadness", () => {
    it("classifies steady, unhurried, matter-of-fact speech as calm rather than defaulting to neutral", () => {
      // Deliberately steady/low-variation but NOT warm (no positive valence
      // cues, unlike the gratitude fixture above) and NOT low-pitch (unlike
      // sadness) — plain, composed speech that previously had no positive
      // scoring rule of its own and fell through to bare "neutral" by omission.
      const steadySpeech: AcousticFeatures = {
        rmsEnergy: 1100,
        zeroCrossingRate: 0.1,
        pitchHz: 190,
        pitchVariation: 0.1,
        speakingRateWPM: 148,
        pauseDurationMs: 0,
        pauseCount: 0,
        durationMs: 4000,
        energyModulationRate: 0.1,
        pitchContour: "flat",
      };
      const emotion = detectAudioEmotion(steadySpeech);
      expect(emotion).not.toBeNull();
      expect(emotion!.label).toBe("calm");
    });
  });

  describe("decibels — new loudness feature on AcousticFeatures", () => {
    it("computes a near-0 dBFS value for a loud, high-amplitude tone", () => {
      const loud = generateSteadyPCM(200, 2000, 30000);
      const features = extractAcousticFeatures(loud, 5);
      expect(features.decibels).toBeDefined();
      expect(features.decibels!).toBeGreaterThan(-6);
      expect(features.decibels!).toBeLessThanOrEqual(0);
    });

    it("computes a strongly negative dBFS value for a very quiet tone", () => {
      const quiet = generateSteadyPCM(200, 2000, 300);
      const features = extractAcousticFeatures(quiet, 5);
      expect(features.decibels).toBeDefined();
      expect(features.decibels!).toBeLessThan(-20);
    });
  });
});
