import { describe, it, expect } from "vitest";
import { detectTextEmotion, fuseEmotion } from "../../lib/emotion/detect";
import type { ConfidenceCategory } from "../../lib/types";

describe("Emotion Detection Lexicon & Calibration Suite (Issue #23)", () => {
  describe("Colloquial Contractions (Issue #23)", () => {
    it("matches feeling low variants", async () => {
      const res = (await detectTextEmotion("i m feelin low")).primary;
      expect(res.label).toBe("sadness");
      expect(res.confidence).toBeGreaterThan(0);
      expect(res.confidenceCategory?.level).toBeDefined();
    });

    it("matches feeling low with apostrophe", async () => {
      const res = (await detectTextEmotion("feelin' low")).primary;
      expect(res.label).toBe("sadness");
    });

    it("matches explicit feeling low", async () => {
      const res = (await detectTextEmotion("feeling low")).primary;
      expect(res.label).toBe("sadness");
    });

    it("matches feel low", async () => {
      const res = (await detectTextEmotion("feel low")).primary;
      expect(res.label).toBe("sadness");
    });

    it("matches frustration contractions", async () => {
      const res = (await detectTextEmotion("costin me money")).primary;
      expect(res.label).toBe("frustration");
    });

    it("matches distress contractions", async () => {
      const res = (await detectTextEmotion("breakin' down")).primary;
      expect(res.label).toBe("distress");
    });
  });

  describe("Safety Nets", () => {
    it("defaults to neutral for normal inputs", async () => {
      // The lexicon finds no keyword match here, so per detect.ts's priority
      // (lexicon-on-match > Local ONNX > HF > lexicon-default) the real
      // local ONNX model gets to decide — and correctly returns "neutral"
      // with much higher confidence than the lexicon's bare 0.5 default,
      // which is the whole point of wiring it into production.
      const res = (await detectTextEmotion("this is a completely normal day")).primary;
      expect(res.label).toBe("neutral");
      expect(res.confidence).toBeGreaterThan(0.5);
      expect(res.confidenceCategory?.level).toBeDefined();
    });

    it("preserves positive excitement without regression", async () => {
      const res = (await detectTextEmotion("this is absolutely amazing!!!")).primary;
      expect(res.label).toBe("excitement");
      expect(res.confidence).toBeGreaterThan(0.5);
    });

    it("preserves gratitude correctly", async () => {
      const res = (await detectTextEmotion("thank you so much for the support")).primary;
      expect(res.label).toBe("gratitude");
    });
  });

  describe("Late Fusion (fuseEmotion)", () => {
    it("keeps the words' emotion when they name one, letting the voice shape only intensity", async () => {
      const textSig = (await detectTextEmotion("i am angry")).primary;
      const audioSig = {
        label: "sadness" as any,
        intensity: 0.5,
        confidence: 1, // Max confidence to overpower ML text
        confidenceCategory: { level: "high", range: [0.7, 1], explanation: "Mock" } as ConfidenceCategory,
        vad: { v: -0.6, a: -0.2, d: -0.3 },
        source: "audio" as const,
        at: Date.now(),
      };

      const fused = fuseEmotion(textSig, audioSig);
      expect(fused.source).toBe("fused");
      // A confident voice read used to swap the label ("sadness"); measured
      // on a real call that made the voice out-vote correct words 7 times
      // in 10. The words now decide which emotion, the voice how strong.
      expect(fused.label).toBe("anger");
      expect(fused.audioSignal?.label).toBe("sadness");
    });

    it("doesn't let a confident voice 'confusion' override clear words (measured live-call failure)", () => {
      const voice: any = {
        label: "confusion", intensity: 0.3, confidence: 0.82,
        confidenceCategory: { level: "high", range: [0.7, 1], explanation: "Mock" },
        vad: { v: -0.2, a: 0.1, d: -0.2 }, source: "audio", at: Date.now(),
      };
      const words = (label: string, confidence: number, vad = { v: -0.5, a: 0.5, d: -0.3 }): any => ({
        label, intensity: 0.5, confidence,
        confidenceCategory: { level: "medium", range: [0.4, 0.7], explanation: "Mock" },
        vad, source: "text", at: Date.now(),
      });
      // Confidences as the lexicon scored them on the call.
      expect(fuseEmotion(words("fear", 0.56), voice).label).toBe("fear");
      expect(fuseEmotion(words("frustration", 0.59), voice).label).toBe("frustration");
      expect(fuseEmotion(words("joy", 0.69, { v: 0.7, a: 0.5, d: 0.3 }), voice).label).toBe("joy");
      // Unsure words: the voice can still decide.
      expect(fuseEmotion(words("neutral", 0.48, { v: 0, a: 0, d: 0 }), voice).label).toBe("confusion");
    });

    it("goes text-heavy (70/30) when text is confident (>0.7) — text wins even though audio has higher raw confidence", () => {
      const textSig: any = {
        label: "gratitude", intensity: 0.5, confidence: 0.75,
        confidenceCategory: { level: "high", range: [0.7, 1], explanation: "Mock" },
        vad: { v: 0.6, a: 0.2, d: 0.1 }, source: "text", at: Date.now(),
      };
      const audioSig: any = {
        label: "sadness", intensity: 0.5, confidence: 0.95,
        confidenceCategory: { level: "high", range: [0.7, 1], explanation: "Mock" },
        vad: { v: -0.6, a: -0.2, d: -0.3 }, source: "audio", at: Date.now(),
      };
      // Under the old raw-confidence-margin rule this would pick audio
      // (0.95 > 0.75 + 0.15); the 70/30 text-heavy weight for confident text
      // flips it to text (0.75*0.7=0.525 > 0.95*0.3=0.285 + 0.15).
      const fused = fuseEmotion(textSig, audioSig);
      expect(fused.label).toBe("gratitude");
    });

    it("goes acoustic-heavy (40/60) when text is vague (<=0.7) — a mildly more confident acoustic read wins", () => {
      const textSig: any = {
        label: "neutral", intensity: 0.2, confidence: 0.5,
        confidenceCategory: { level: "medium", range: [0.4, 0.7], explanation: "Mock" },
        vad: { v: 0, a: 0, d: 0 }, source: "text", at: Date.now(),
      };
      const audioSig: any = {
        label: "distress", intensity: 0.6, confidence: 0.6,
        confidenceCategory: { level: "medium", range: [0.4, 0.7], explanation: "Mock" },
        vad: { v: -0.7, a: 0.6, d: -0.4 }, source: "audio", at: Date.now(),
      };
      // Under the old rule neither margin is met (tie → text). The 40/60
      // acoustic-heavy weight for vague text flips it to audio
      // (0.6*0.6=0.36 > 0.5*0.4=0.2 + 0.15).
      const fused = fuseEmotion(textSig, audioSig);
      expect(fused.label).toBe("distress");
    });
  });
});

describe("Patient phrasing (scripted live-call sentences)", () => {
  // The words-side reading of the sentences used for the measured test call.
  const cases: Array<[string, string]> = [
    ["Honestly, I'm in a lot of pain since yesterday.", "distress"],
    ["I've had a headache since the surgery.", "distress"],
    ["I'm really worried that something went wrong in the surgery.", "fear"],
    ["Why does nobody from the hospital answer my call? This is literally the third time.", "frustration"],
    ["I feel very low. I cannot do anything by myself.", "sadness"],
    ["Oh, that's a good news. Thank you so much.", "joy"],
    ["I don't understand, like, which medicine to take and when.", "confusion"],
  ];
  it.each(cases)("%s → %s", async (text, label) => {
    expect((await detectTextEmotion(text)).lexicon.label).toBe(label);
  });

  it("doesn't call feeling good again frustration, or 'no pain' distress", async () => {
    expect((await detectTextEmotion("I'm feeling good again")).lexicon.label).not.toBe("frustration");
    expect((await detectTextEmotion("there's no pain now")).lexicon.label).not.toBe("distress");
  });
});
