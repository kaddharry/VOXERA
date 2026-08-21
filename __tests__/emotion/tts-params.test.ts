import { describe, it, expect } from "vitest";
import { getEmotionTTSParams, applyEmotionProsody } from "../../lib/emotion/tts-params";
import type { PolicyDirectives } from "../../lib/types";

const basePolicy: PolicyDirectives = {
  acknowledgeFirst: false,
  pace: "normal",
  allowUpsell: true,
  escalate: "none",
  notes: [],
};

describe("Emotion TTS Prosody Mapping", () => {
  it("maps distress to the appealing tone with long pauses", () => {
    const params = getEmotionTTSParams("distress");
    expect(params.toneMode).toBe("appealing");
    expect(params.pauseStrategy).toBe("long");

    const shaped = applyEmotionProsody("I can help you. Please stay calm.", params);
    expect(shaped).toContain("...");
  });

  it("maps excitement to the pleasing tone with no extra pauses", () => {
    const params = getEmotionTTSParams("excitement");
    expect(params.toneMode).toBe("pleasing");
    expect(params.pauseStrategy).toBe("none");

    const shaped = applyEmotionProsody("That is awesome!", params);
    expect(shaped).toBe("That is awesome!");
  });

  it("defaults to neutral for undefined emotion", () => {
    const params = getEmotionTTSParams(undefined);
    expect(params.toneMode).toBe("neutral");
    expect(params.pauseStrategy).toBe("none");
  });

  it("maps sadness/disappointment to the empathetic tone", () => {
    expect(getEmotionTTSParams("sadness").toneMode).toBe("empathetic");
    expect(getEmotionTTSParams("disappointment").toneMode).toBe("empathetic");
  });

  it("maps confusion/fear to the dominant tone", () => {
    expect(getEmotionTTSParams("confusion").toneMode).toBe("dominant");
    expect(getEmotionTTSParams("fear").toneMode).toBe("dominant");
  });

  it("maps calm to the playful tone (not a literal 'flirty' mode — none exists)", () => {
    expect(getEmotionTTSParams("calm").toneMode).toBe("playful");
  });

  it("escalation policy forces the appealing tone even for an otherwise-neutral emotion", () => {
    const policy: PolicyDirectives = { ...basePolicy, escalate: "human" };
    expect(getEmotionTTSParams("neutral", policy).toneMode).toBe("appealing");
  });

  it("acknowledgeFirst forces the appealing tone even for an otherwise-neutral emotion", () => {
    const policy: PolicyDirectives = { ...basePolicy, acknowledgeFirst: true };
    expect(getEmotionTTSParams("neutral", policy).toneMode).toBe("appealing");
  });

  it("a task-critical caller utterance forces the serious tone, overriding a positive emotion", () => {
    const params = getEmotionTTSParams("joy", basePolicy, "I need a refund for my last payment");
    expect(params.toneMode).toBe("serious");
  });

  it("serious tone takes precedence over the appealing escalation override", () => {
    const policy: PolicyDirectives = { ...basePolicy, escalate: "human" };
    const params = getEmotionTTSParams("anger", policy, "please cancel my subscription and refund the charge");
    expect(params.toneMode).toBe("serious");
  });

  it("every tone mode carries ElevenLabs voice settings within documented ranges", () => {
    const modes: Array<Parameters<typeof getEmotionTTSParams>[0]> = [
      "neutral", "calm", "frustration", "anger", "distress", "fear",
      "confusion", "joy", "gratitude", "excitement", "sadness", "disappointment",
    ];
    for (const emotion of modes) {
      const { elevenLabsVoiceSettings } = getEmotionTTSParams(emotion);
      expect(elevenLabsVoiceSettings.stability).toBeGreaterThanOrEqual(0);
      expect(elevenLabsVoiceSettings.stability).toBeLessThanOrEqual(1);
      expect(elevenLabsVoiceSettings.style).toBeGreaterThanOrEqual(0);
      expect(elevenLabsVoiceSettings.speed).toBeGreaterThanOrEqual(0.5);
      expect(elevenLabsVoiceSettings.speed).toBeLessThanOrEqual(2);
    }
  });
});
