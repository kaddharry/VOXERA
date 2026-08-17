import { describe, it, expect } from "vitest";
import { detectTextEmotionLexicon } from "../../lib/emotion/detect";

describe("BUG-E4 — positive uses of 'wait' are not frustration", () => {
  it("does not flag an excited 'can't wait' as frustration", () => {
    const sig = detectTextEmotionLexicon("I can't wait to start!!");

    expect(sig.label).not.toBe("frustration");
    expect(sig.label).toBe("excitement");
    expect(sig.isMixed).toBe(false);
    expect(sig.vad.v).toBeGreaterThan(0.5);
  });

  it("does not flag polite or conversational 'wait'", () => {
    for (const text of [
      "please wait",
      "wait, let me think",
      "wait a second",
    ]) {
      const sig = detectTextEmotionLexicon(text);
      expect(sig.label).not.toBe("frustration");
    }
  });
});

describe("BUG-E4 — genuine waiting complaints still register", () => {
  it.each([
    "I've been waiting for hours",
    "I'm still waiting for someone to call me back",
    "I've been waiting too long",
    "this is a long wait",
  ])("still detects frustration in %j", (text) => {
    expect(detectTextEmotionLexicon(text).label).toBe("frustration");
  });

  it("keeps the other frustration triggers intact", () => {
    expect(
      detectTextEmotionLexicon("this is the third time I'm calling").label
    ).toBe("frustration");

    expect(
      detectTextEmotionLexicon("I'm fed up with this").label
    ).toBe("frustration");

    expect(
      detectTextEmotionLexicon("this is ridiculous").label
    ).toBe("frustration");
  });

  it.todo(
    "should detect frustration in \"I'm sick of this\" (blocked by existing 'sick' slang collision)"
  );
});