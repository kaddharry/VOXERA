import { describe, it, expect } from "vitest";
import { detectTextEmotionLexicon, detectTextEmotion } from "../../lib/emotion/detect";

/**
 * Findings from running scripts/simulate-call-emotion.ts's scripted,
 * multi-turn calls and adversarial single-shot inputs through the real
 * pipeline (not isolated single-sentence checks).
 */

describe("BUG-E15 — a resolved symptom still reads as distress", () => {
  // "Call B" (recovering/happy patient) in the simulation: "The pain has
  // pretty much gone away" scored as DISTRESS (v=-0.70), because the bare
  // "pain" keyword fires regardless of whether the sentence is reporting
  // the symptom or reporting that it's OVER. The lexicon has no concept of
  // tense/resolution — only negation ("no pain"), which doesn't cover "the
  // pain is gone" (no negation word present, just a resolution phrase).
  it.each([
    "the pain has pretty much gone away",
    "the pain is gone now",
    "my pain has resolved",
    "the pain is finally gone",
    "no more pain",
    "I'm pain-free now",
  ])("flags %j as positive, not distress", (text) => {
    const sig = detectTextEmotionLexicon(text);
    expect(sig.label).not.toBe("distress");
    expect(sig.vad.v).toBeGreaterThan(0);
  });

  it("a genuinely still-present pain report is unaffected", () => {
    expect(detectTextEmotionLexicon("I'm in a lot of pain since yesterday").label).toBe("distress");
  });
});

describe("BUG-E16 — the router discards the lexicon's own punctuation-only signal", () => {
  // detectTextEmotion()'s "lexicon wins outright" gate checked
  // `matchedKeywords.length > 0` — but detectTextEmotionLexicon's
  // punctuation heuristics (repeated "?" -> confusion, repeated "!" ->
  // excitement, with no negative keyword present) can set a non-neutral
  // label WITHOUT any matchedKeywords entry (punctuation isn't a
  // "keyword"). The router then fell through to the ONNX fallback, which
  // is far less predictable on word-sparse, punctuation-heavy text.
  // scripts/simulate-call-emotion.ts's adversarial run showed this flipping
  // the valence sign entirely: "!!!!" alone read as EXCITEMENT (positive)
  // from the lexicon's own deliberate design, but ANGER (negative) once
  // routed to ONNX because the gate didn't trust the lexicon's own answer.
  it("trusts the lexicon's punctuation-only excitement read instead of falling through to ONNX", async () => {
    const result = await detectTextEmotion("!!!!!!!!!!!!!!!!");
    expect(result.selection.engine).toBe("lexicon");
    expect(result.primary.label).toBe("excitement");
    expect(result.primary.vad.v).toBeGreaterThan(0);
  });

  it("trusts the lexicon's punctuation-only confusion read instead of falling through to ONNX", async () => {
    const result = await detectTextEmotion("??????");
    expect(result.selection.engine).toBe("lexicon");
    expect(result.primary.label).toBe("confusion");
  });

  it("still falls through to ONNX when punctuation adds no real signal (stays neutral)", async () => {
    const result = await detectTextEmotion("...");
    expect(result.primary.label).toBe("neutral");
  });
});
