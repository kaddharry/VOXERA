import { describe, it, expect } from "vitest";
import { detectTextEmotion, fuseEmotion } from "../../lib/emotion/detect";

describe("Emotion Detection Lexicon & Calibration Suite (Issue #23)", () => {
  describe("Colloquial Negative Contractions", () => {
    it("classifies 'i m feelin low' as sadness", () => {
      const res = detectTextEmotion("i m feelin low");
      expect(res.label).toBe("sadness");
      expect(res.confidence).toBeGreaterThan(0);
      expect(res.confidenceCategory?.level).toBeDefined();
    });

    it("classifies 'feelin' low' as sadness", () => {
      const res = detectTextEmotion("feelin' low");
      expect(res.label).toBe("sadness");
    });

    it("classifies 'feeling low' as sadness", () => {
      const res = detectTextEmotion("feeling low");
      expect(res.label).toBe("sadness");
    });

    it("classifies 'feel low' as sadness", () => {
      const res = detectTextEmotion("feel low");
      expect(res.label).toBe("sadness");
    });

    it("classifies 'costin me money' as frustration", () => {
      const res = detectTextEmotion("costin me money");
      expect(res.label).toBe("frustration");
    });

    it("classifies 'breakin' down' as distress", () => {
      const res = detectTextEmotion("breakin' down");
      expect(res.label).toBe("distress");
    });
  });

  describe("Neutral & Positive Sentiment Coverage", () => {
    it("classifies neutral statements as neutral", () => {
      const res = detectTextEmotion("this is a completely normal day");
      expect(res.label).toBe("neutral");
      expect(res.confidence).toBe(0.5);
      expect(res.confidenceCategory?.level).toBe("medium");
    });

    it("classifies positive statements correctly without regression", () => {
      const res = detectTextEmotion("this is absolutely amazing!!!");
      expect(res.label).toBe("excitement");
      expect(res.confidence).toBeGreaterThan(0.5);
    });

    it("correctly identifies gratitude", () => {
      const res = detectTextEmotion("thank you so much for the support");
      expect(res.label).toBe("gratitude");
    });
  });

  describe("Late Fusion (fuseEmotion)", () => {
    it("fuses text and audio emotion signals correctly", () => {
      const textSig = detectTextEmotion("i am angry");
      const audioSig = {
        label: "sadness",
        intensity: 0.5,
        confidence: 0.8,
        confidenceCategory: { level: "high", explanation: "Mock" },
        vad: { v: -0.6, a: -0.2, d: -0.3 },
        source: "audio" as const,
        at: Date.now(),
      };

      const fused = fuseEmotion(textSig, audioSig);
      expect(fused.source).toBe("fused");
      expect(fused.label).toBe("sadness"); // Takes label from higher confidence source (audio 0.8 > text 0.57)
    });
  });
});
