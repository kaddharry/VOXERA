import { describe, it, expect } from "vitest";
import { DATASET } from "./fixtures/emotion-dataset";
import { HOLDOUT } from "./fixtures/emotion-holdout";
import { detectTextEmotion } from "../../lib/emotion/detect";
import { parseEmotionLabel, EMOTION_LABELS } from "../../lib/emotion/llm-emotion";

async function accuracy(cases: typeof DATASET) {
  let ok = 0;
  for (const c of cases) {
    const got = (await detectTextEmotion(c.text, { language: c.lang === "en" ? "en-IN" : "auto" })).primary.label;
    if (got === c.label) ok++;
  }
  return ok / cases.length;
}

describe("instant multilingual emotion rules (fast path)", () => {
  it("label the development set well in all four languages", async () => {
    expect(await accuracy(DATASET)).toBeGreaterThan(0.75);
  });
  it("hold up on the held-out set", async () => {
    expect(await accuracy(HOLDOUT)).toBeGreaterThan(0.85);
  });
  it.each([
    ["thank you so much", "gratitude"],
    ["I'm so happy today", "joy"],
    ["मुझे सीने में दर्द है", "pain"],
    ["ਮੈਂ ਬਹੁਤ ਖੁਸ਼ ਹਾਂ", "joy"],
    ["mujhe bahut chinta ho rahi hai", "worry"],
  ])("%s -> %s", async (text, label) => {
    expect((await detectTextEmotion(text, { language: "auto" })).primary.label).toBe(label);
  });
});

describe("parseEmotionLabel", () => {
  it("accepts every label the classifier may return, any case or punctuation", () => {
    for (const l of EMOTION_LABELS) expect(parseEmotionLabel(` ${l.toUpperCase()}. `)).toBe(l);
  });
  it("rejects anything else", () => {
    expect(parseEmotionLabel("happiness")).toBeNull();
    expect(parseEmotionLabel("")).toBeNull();
  });
});
