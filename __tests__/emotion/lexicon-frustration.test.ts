/**
 * Tests: BUG-E4 — "wait" as a standalone frustration trigger
 * (lib/emotion/lexicon.ts)
 *
 * "wait" matched the frustration regex as a bare word, so "I can't wait to
 * start!!" was classified as frustration. Worse, the resulting hasNegMatch
 * suppressed the "!!" positivity amplifier in detect.ts, so an excited caller
 * came out negative. Genuine waiting complaints must still be caught.
 *
 * Run: npx vitest run __tests__/emotion/lexicon-frustration.test.ts
 */

import { describe, it, expect } from "vitest";
import { detectTextEmotion } from "../../lib/emotion/detect";

describe("BUG-E4 — positive uses of 'wait' are not frustration", () => {
  it("does not flag an excited 'can't wait'", () => {
    const sig = detectTextEmotion("I can't wait to start!!");

    expect(sig.label).not.toBe("frustration");
    expect(sig.label).toBe("excitement");
    // Label alone does not prove the fix: "can't wait" is itself an excitement
    // keyword (lexicon.ts) and outscored frustration even before it. Valence is
    // the discriminator — the frustration match used to drag it to ~0.18 and
    // suppress the "!!" positivity amplifier, which only fires on no neg match.
    expect(sig.vad.v).toBeGreaterThan(0.5);
  });

  it("does not flag 'can't wait' as a mixed emotion", () => {
    // hasNegMatch used to be true here, which flipped isMixed on and routed
    // the caller to the mixed-emotion persona instead of the positive one.
    expect(detectTextEmotion("I can't wait to start!!").isMixed).toBe(false);
  });

  it("does not flag polite or conversational 'wait'", () => {
    for (const text of ["please wait", "wait, let me think", "wait a second"]) {
      expect(detectTextEmotion(text).label).not.toBe("frustration");
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
    expect(detectTextEmotion(text).label).toBe("frustration");
  });

  it("keeps the other frustration triggers intact", () => {
    expect(detectTextEmotion("this is the third time I'm calling").label).toBe("frustration");
    expect(detectTextEmotion("I'm fed up with this").label).toBe("frustration");
    expect(detectTextEmotion("this is ridiculous").label).toBe("frustration");
  });

  // NOTE: "I'm sick of this" currently resolves to *excitement*, not frustration.
  // "sick" is an excitement keyword (lexicon.ts, slang for "awesome") and its
  // weight beats the "sick of" frustration entry. That is a separate, pre-existing
  // bug in the same family as BUG-E4 — a short slang token over-matching a
  // multi-word negative phrase — and is deliberately not fixed here.
  it.todo("should detect frustration in \"I'm sick of this\" (blocked by 'sick' slang collision)");
});
