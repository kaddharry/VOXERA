import { describe, it, expect } from "vitest";
import { detectTextEmotionLexicon } from "../../lib/emotion/detect";

/**
 * BUG-E14 (the headline finding of this round): several lexicon entries use
 * a bare word STEM deliberately meant to prefix-match its inflected forms
 * — e.g. "frustrat" for "frustrated"/"frustrating", "excit" for
 * "excited"/"exciting", "suicid" for "suicidal"/"suicide" — but every
 * alternative in the file is wrapped in a single outer `\b(?:...)\b`. The
 * trailing `\b` applies to EVERY branch, including the stems, so it
 * requires a word boundary immediately after the bare stem itself. Since
 * none of the real inflected words end where the stem does, these
 * alternatives matched NOTHING in real English: `/\bfrustrat\b/` does not
 * match "frustrated" at all (there's no boundary between "frustrat" and
 * "ed" — both are word characters). Confirmed with a direct regex test
 * before writing this file.
 *
 * The worst instance: the self-harm/suicide detection pattern
 * `suicid|harm myself|end it|die|kill myself|wanna die` only matched exact
 * base forms. "I think about ending it all" (ending, not "end it"),
 * "I am suicidal", "I keep thinking about harming/killing myself", and
 * "I think about dying" all matched NOTHING — and fell through to the
 * generic ONNX fallback, which (per scripts/simulate-call-emotion.ts's
 * run) read a nearby turn about being "overwhelmed" as EXCITEMENT at 0.89
 * confidence. This is the single highest-severity finding of the audit.
 */
describe("BUG-E14 — self-harm language (SAFETY CRITICAL)", () => {
  it.each([
    "I think about ending it all",
    "sometimes I think about ending things",
    "I am suicidal",
    "I've been having suicidal thoughts",
    "I keep thinking about harming myself",
    "I think about killing myself",
    "I just want to die",
    "I think about dying",
    "I don't want to be here anymore",
    "I feel like giving up on everything",
  ])("flags %j as distress, not neutral", (text) => {
    const sig = detectTextEmotionLexicon(text);
    expect(sig.label).toBe("distress");
    expect(sig.matchedKeywords.length).toBeGreaterThan(0);
  });

  it("still catches the base forms it always worked for", () => {
    expect(detectTextEmotionLexicon("I want to end it").label).toBe("distress");
    expect(detectTextEmotionLexicon("I want to harm myself").label).toBe("distress");
    expect(detectTextEmotionLexicon("I want to kill myself").label).toBe("distress");
  });
});

describe("BUG-E14 — common emotion words in their natural inflected form", () => {
  it.each([
    ["I am so frustrated with this", "frustration"],
    ["this is so frustrating", "frustration"],
    ["I am so excited", "excitement"],
    ["this is so exciting", "excitement"],
    ["I am confused", "confusion"],
    ["this is confusing", "confusion"],
    ["we should celebrate", "excitement"],
    ["we are celebrating today", "excitement"],
    ["I am so disappointed", "disappointment"],
    ["that is disappointing", "disappointment"],
    ["I am stressed", "distress"],
    ["today was so stressful", "distress"],
    ["I am overwhelmed", "distress"],
    ["I really appreciated that", "gratitude"],
    ["I'm so relieved", "joy"],
    ["this is outrageous", "anger"],
    ["I was outraged", "anger"],
  ])("flags %j as %s via an actual keyword match, not the ONNX fallback", (text, expectedLabel) => {
    const sig = detectTextEmotionLexicon(text);
    expect(sig.label).toBe(expectedLabel);
    expect(sig.matchedKeywords.length).toBeGreaterThan(0);
  });
});
