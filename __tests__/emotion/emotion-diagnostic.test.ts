import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the network/model-dependent Local ONNX engine so this suite is fast
// and deterministic. HF was scrapped from the pipeline entirely (see
// detect.ts) — it was the exact same model as Local ONNX run over the
// network, and a scripted accuracy eval showed it never once changed the
// selected label, so `result.hf` is now always the fixed "disabled" stub
// and there is nothing to mock for it.
const mockDetectTextEmotionLocalONNX = vi.fn();
vi.mock("../../lib/emotion/local-onnx-detect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/emotion/local-onnx-detect")>();
  return { ...actual, detectTextEmotionLocalONNX: (...args: unknown[]) => mockDetectTextEmotionLocalONNX(...args) };
});

import { runDiagnosticEmotion } from "../../lib/emotion/emotion-debug";
import type { AcousticFeatures } from "../../lib/types";

const NEUTRAL_ONNX = { signal: null, latencyMs: 5, errored: false };

describe("Issue: Emotion Engine Overhaul — diagnostic instrumentation", () => {
  beforeEach(() => {
    mockDetectTextEmotionLocalONNX.mockReset().mockResolvedValue(NEUTRAL_ONNX);
  });

  describe("Diagnostic output completeness", () => {
    it("populates all four engine breakdowns (hf, lexicon, localOnnx, acoustic) when acoustic features are given", async () => {
      const acoustic: AcousticFeatures = {
        rmsEnergy: 3000, zeroCrossingRate: 0.1, pitchHz: 200, pitchVariation: 0.3,
        speakingRateWPM: 140, pauseDurationMs: 0, pauseCount: 0, durationMs: 3000,
      };
      const result = await runDiagnosticEmotion("i am furious", acoustic);

      expect(result.hf).toBeDefined();
      expect(result.lexicon).toBeDefined();
      expect(result.localOnnx).toBeDefined();
      expect(result.acoustic).not.toBeNull();
      expect(result.fusion.final).toBeDefined();
      expect(result.fusion.textSelection).toBeDefined();
      expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns acoustic: null when no acoustic features are provided", async () => {
      const result = await runDiagnosticEmotion("i am furious");
      expect(result.acoustic).toBeNull();
    });

    it("always includes lexicon keywords in the lexicon engine breakdown", async () => {
      const result = await runDiagnosticEmotion("this is terrible and frustrating");
      expect(result.lexicon.available).toBe(true);
      expect(result.lexicon.matchedKeywords).toBeDefined();
      expect(result.lexicon.matchedKeywords!.length).toBeGreaterThan(0);
    });

    it("computes per-engine importance and memory tier for every available engine", async () => {
      mockDetectTextEmotionLocalONNX.mockResolvedValue({
        signal: {
          label: "anger", intensity: 0.8, confidence: 0.9,
          confidenceCategory: { level: "high", range: [0.7, 1], explanation: "mock" },
          vad: { v: -0.8, a: 0.8, d: 0.5 }, source: "text", at: Date.now(),
        },
        latencyMs: 10, errored: false,
      });

      const result = await runDiagnosticEmotion("i am furious about this");

      expect(result.lexicon.importance).not.toBeNull();
      expect(result.lexicon.memoryClassification).not.toBeNull();
      expect(result.localOnnx.importance).not.toBeNull();
      expect(result.localOnnx.memoryClassification).not.toBeNull();
      // HF is scrapped -> always no signal -> no importance
      expect(result.hf.importance).toBeNull();
    });
  });

  describe("Engine unavailability is reported, not silently dropped", () => {
    it("marks HF permanently unavailable with a reason explaining it was scrapped", async () => {
      const result = await runDiagnosticEmotion("hello there");
      expect(result.hf.available).toBe(false);
      expect(result.hf.label).toBeNull();
      expect(result.hf.latencyMs).toBe(0);
      expect(result.hf.unavailableReason).toMatch(/removed/i);
    });

    it("marks Local ONNX unavailable with a reason when it errors", async () => {
      mockDetectTextEmotionLocalONNX.mockResolvedValue({ signal: null, latencyMs: 5, errored: true });
      const result = await runDiagnosticEmotion("hello there");
      expect(result.localOnnx.available).toBe(false);
      expect(result.localOnnx.unavailableReason).toBeDefined();
    });
  });

  describe("Production fusion selection is mirrored accurately", () => {
    it("selects Local ONNX as primary and reflects that in fusion.textSelection when it returns a valid signal", async () => {
      mockDetectTextEmotionLocalONNX.mockResolvedValue({
        signal: {
          label: "joy", intensity: 0.7, confidence: 0.9,
          confidenceCategory: { level: "high", range: [0.7, 1], explanation: "mock" },
          vad: { v: 0.8, a: 0.5, d: 0.3 }, source: "text", at: Date.now(),
        },
        latencyMs: 10, errored: false,
      });

      const result = await runDiagnosticEmotion("neutral filler text");
      expect(result.fusion.textSelection.engine).toBe("local_onnx");
      expect(result.fusion.final.label).toBe("joy");
    });

    it("falls back to lexicon and reflects that in fusion.textSelection when Local ONNX is unavailable", async () => {
      const result = await runDiagnosticEmotion("this is terrible");
      expect(result.fusion.textSelection.engine).toBe("lexicon");
      expect(result.fusion.final.label).toBe(result.lexicon.label);
    });
  });

  describe("Comparative test cases from the emotion engine overhaul issue", () => {
    it("'my pencil broke' — lexicon has no real signal, Local ONNX's opinion is used and hf stays the fixed stub", async () => {
      mockDetectTextEmotionLocalONNX.mockResolvedValue({
        signal: {
          label: "disappointment", intensity: 0.3, confidence: 0.55,
          confidenceCategory: { level: "medium", range: [0.4, 0.7], explanation: "mock" },
          vad: { v: -0.3, a: -0.1, d: -0.1 }, source: "text", at: Date.now(),
        },
        latencyMs: 15, errored: false,
      });

      const result = await runDiagnosticEmotion("my pencil broke");
      // Weak/no lexicon signal for this neutral-ish sentence.
      expect(result.lexicon.label).toBe("neutral");
      expect(result.localOnnx.label).toBe("disappointment");
      expect(result.fusion.textSelection.engine).toBe("local_onnx");
      expect(result.hf).toEqual(expect.objectContaining({ available: false }));
    });

    it("sarcasm ('oh great, another bug') — lexicon misreads positive keyword, engines can disagree", async () => {
      const result = await runDiagnosticEmotion("oh great, another bug");
      // The naive lexicon keys off "great" and misses the sarcasm.
      expect(result.lexicon.label).toBe("joy");
    });

    it("ambiguous input ('I can't believe this') — diagnostic exposes low-confidence neutral default rather than guessing", async () => {
      const result = await runDiagnosticEmotion("I can't believe this");
      expect(result.lexicon.label).toBe("neutral");
      expect(result.lexicon.confidence).toBe(0.5);
    });
  });
});
