/**
 * Tests: BUG-E6 — fuseEmotion dropped isMixed on the audio path
 * (lib/emotion/detect.ts)
 *
 * isMixed is computed in detectTextEmotion but the audio-fusion branch built a
 * fresh object without it. Telephony calls always supply an audio signal, so
 * isMixed was always undefined on a phone call and the mixed-emotion persona
 * never fired. The text-only branch (audio === null) spreads ...text and was
 * unaffected — which is why this never showed up in browser testing.
 *
 * Run: npx vitest run __tests__/emotion/fusion-mixed.test.ts
 */

import { describe, it, expect } from "vitest";
import { detectTextEmotion, fuseEmotion } from "../../lib/emotion/detect";
import type { EmotionSignal } from "../../lib/types";

// "love it" (joy) + "unacceptable" (frustration) → both polarities hit.
const MIXED_TEXT = "I love it but this billing error is unacceptable";
const POSITIVE_TEXT = "thank you so much, this is wonderful";

function audioSignal(overrides: Partial<EmotionSignal> = {}): EmotionSignal {
  return {
    label: "anger",
    intensity: 0.6,
    confidence: 0.7,
    confidenceCategory: { level: "medium", explanation: "test fixture" },
    vad: { v: -0.5, a: 0.6, d: 0.2 },
    source: "audio",
    at: Date.now(),
    ...overrides,
  };
}

describe("BUG-E6 — isMixed survives audio fusion", () => {
  it("preserves isMixed: true through the audio path", () => {
    const text = detectTextEmotion(MIXED_TEXT);
    expect(text.isMixed).toBe(true); // precondition: detector found both polarities

    expect(fuseEmotion(text, audioSignal()).isMixed).toBe(true);
  });

  it("preserves isMixed: false through the audio path", () => {
    const text = detectTextEmotion(POSITIVE_TEXT);
    expect(text.isMixed).toBe(false);

    expect(fuseEmotion(text, audioSignal()).isMixed).toBe(false);
  });

  it("still preserves isMixed on the text-only path", () => {
    expect(fuseEmotion(detectTextEmotion(MIXED_TEXT), null).isMixed).toBe(true);
  });

  it("agrees between the audio and text-only paths", () => {
    const text = detectTextEmotion(MIXED_TEXT);

    expect(fuseEmotion(text, audioSignal()).isMixed).toBe(fuseEmotion(text, null).isMixed);
  });

  it("is never undefined once fused, whatever the audio confidence", () => {
    const text = detectTextEmotion(MIXED_TEXT);

    // Label selection flips on confidence; isMixed must survive either branch.
    for (const confidence of [0.1, 0.99]) {
      expect(fuseEmotion(text, audioSignal({ confidence })).isMixed).toBeDefined();
    }
  });
});
