import { describe, expect, it } from "vitest";
import { describeCallEmotion, summarizeCallEmotion, type TurnEmotion } from "../../lib/emotion/call-emotion";

const t = (label: TurnEmotion["label"], intensity: number, v: number): TurnEmotion => ({ label, intensity, vad: { v, a: 0, d: 0 } });

describe("summarizeCallEmotion", () => {
  it("returns null for a call with no emotion readings", () => {
    expect(summarizeCallEmotion([])).toBeNull();
  });

  it("finds the dominant emotion, the strongest negative moment and an improving trend", () => {
    // The scripted test call, read as intended.
    const turns = [
      t("neutral", 0.1, 0), t("distress", 0.7, -0.7), t("fear", 0.5, -0.5), t("frustration", 0.6, -0.6),
      t("sadness", 0.5, -0.7), t("calm", 0.3, 0.2), t("joy", 0.6, 0.7), t("confusion", 0.3, -0.2),
    ];
    const e = summarizeCallEmotion(turns)!;
    expect(e.overall).toBe("distress");
    expect(e.negativeTurns).toBe(5);
    expect(e.positiveTurns).toBe(2);
    expect(e.peakNegative).toEqual({ turn: 2, label: "distress", intensity: 0.7 });
    expect(e.trend).toBe("improved");
    expect(describeCallEmotion(e)).toBe("Mostly distress · 5 of 8 turns negative · improved by the end · strongest: distress at turn 2");
  });

  it("reports a call that got worse, and a calm call as neutral with no negative peak", () => {
    expect(summarizeCallEmotion([t("gratitude", 0.5, 0.6), t("neutral", 0.1, 0), t("anger", 0.8, -0.8)])!.trend).toBe("worsened");
    const calm = summarizeCallEmotion([t("neutral", 0.1, 0), t("neutral", 0.1, 0)])!;
    expect(calm.overall).toBe("neutral");
    expect(calm.peakNegative).toBeNull();
    expect(calm.trend).toBe("steady");
  });
});
