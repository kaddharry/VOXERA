import { describe, it, expect } from "vitest";
import { recomputeEmotionForText } from "../../lib/insights/backfill-emotion";

describe("recomputeEmotionForText — the one-time backfill's core logic", () => {
  it("flags a changed result when today's lexicon now catches something the old one missed", async () => {
    // Exactly the medication-confusion gap filled earlier this session.
    const old = {
      label: "neutral",
      intensity: 0,
      confidence: 0.45,
      vad: { v: 0, a: 0, d: 0 },
      textSignal: { label: "neutral", confidence: 0.45, engine: "local_onnx" },
      audioSignal: null,
    };
    const result = await recomputeEmotionForText("I don't understand, like, which medicine to take when.", old);
    expect(result.changed).toBe(true);
    expect(result.label).toBe("confusion");
    expect(result.confidence).toBeGreaterThan(old.confidence);
  });

  it("flags a changed result for the exact live case this was built for (BUG-E13's 'sadness' quote)", async () => {
    const old = {
      label: "neutral",
      intensity: 0,
      confidence: 0.4,
      vad: { v: 0, a: 0, d: 0 },
      textSignal: { label: "neutral", confidence: 0.4, engine: "local_onnx" },
      audioSignal: { label: "anger", confidence: 0.3 },
    };
    const result = await recomputeEmotionForText("I feel very low. Like, I can't do anything by myself.", old);
    expect(result.changed).toBe(true);
    expect(result.label).toBe("sadness");
  });

  it("does not flag a change when the new read agrees with what's already stored", async () => {
    const old = {
      label: "joy",
      intensity: 0.4,
      confidence: 0.57,
      vad: { v: 0.56, a: 0.35, d: 0.14 },
      textSignal: { label: "joy", confidence: 0.57, engine: "lexicon" },
      audioSignal: null,
    };
    const result = await recomputeEmotionForText("I'm feeling extremely good", old);
    expect(result.changed).toBe(false);
  });

  it("reconstructs a stored audioSignal (label+confidence only) into fusion input without throwing", async () => {
    const old = {
      label: "distress",
      intensity: 0.6,
      confidence: 0.6,
      vad: { v: -0.6, a: 0.5, d: -0.3 },
      textSignal: { label: "distress", confidence: 0.6, engine: "lexicon" },
      audioSignal: { label: "fear", confidence: 0.55 },
    };
    const result = await recomputeEmotionForText("I'm so worried about the surgery", old);
    expect(result.label).toBeDefined();
    expect(Number.isFinite(result.confidence)).toBe(true);
  });
});
