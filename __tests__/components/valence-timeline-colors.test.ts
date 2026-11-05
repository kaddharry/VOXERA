import { describe, it, expect } from "vitest";
import { dotColor, plainLanguage } from "../../components/admin/ValenceTimeline";
import type { EmotionLabel } from "../../lib/types";

/**
 * BUG-E13: "sadness" was missing from both dotColor() and plainLanguage()'s
 * switch statements — it silently fell through to the neutral `default`
 * case, so a clearly negative moment ("I feel very low... I can't do
 * anything by myself") rendered as a neutral cyan dot captioned "Neutral
 * tone". This test enumerates every real EmotionLabel so a future missing
 * case fails loudly here instead of silently miscoloring the timeline.
 */
const ALL_LABELS: EmotionLabel[] = [
  "neutral", "calm", "frustration", "anger", "sadness", "distress",
  "fear", "confusion", "joy", "gratitude", "excitement", "disappointment",
];

const NEUTRAL_CYAN = "#22d3ee";
const DEFAULT_PLAIN = "Neutral tone";

describe("ValenceTimeline color/caption mapping covers every EmotionLabel", () => {
  it("only 'neutral' actually falls through to the neutral/default color and caption", () => {
    for (const label of ALL_LABELS) {
      const color = dotColor(label, 0.9);
      const caption = plainLanguage(label, 0.9);
      if (label === "neutral") {
        expect(color).toBe(NEUTRAL_CYAN);
        expect(caption).toBe(DEFAULT_PLAIN);
      } else {
        expect(color, `dotColor("${label}") should not silently default to neutral`).not.toBe(NEUTRAL_CYAN);
        expect(caption, `plainLanguage("${label}") should not silently default to "Neutral tone"`).not.toBe(DEFAULT_PLAIN);
      }
    }
  });

  it("sadness specifically reads as a negative (red, 'upset' bucket) moment, not neutral", () => {
    expect(dotColor("sadness", 0.9)).toBe("#f87171");
    expect(plainLanguage("sadness", 0.9)).toBe("Sounded sad or down");
  });

  it("low-confidence readings still show as unclear regardless of label", () => {
    expect(dotColor("sadness", 0.2)).toBe("#71717a");
    expect(plainLanguage("sadness", 0.2)).toBe("Unclear — not enough signal to read the mood here");
  });
});
