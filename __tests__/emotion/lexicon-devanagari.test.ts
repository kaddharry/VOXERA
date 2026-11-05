import { describe, it, expect } from "vitest";
import { detectTextEmotionLexicon } from "../../lib/emotion/detect";

/**
 * BUG-E19: Deepgram's documented Hindi STT output (nova-2/nova-3) is
 * Devanagari script, not romanized text — hi-Latn only exists on the
 * legacy nova/base models. So if CONFIG.deepgram.sttHindiCodeSwitching is
 * ever turned on, BUG-E18's Latin-script Hinglish entries would never
 * match actual Hindi speech, only code-switched English sentences with
 * Hindi words dropped in. These Devanagari entries are the counterpart.
 *
 * Also verifies the custom devanagariWord() boundary actually works —
 * confirmed directly in a scratch test that plain \b fails on Devanagari
 * entirely (it's ASCII-only in JS regex) before writing any of this.
 */
describe("BUG-E19 — Devanagari-script Hindi symptom and distress words", () => {
  it.each([
    "मुझे बहुत दर्द हो रहा है",
    "मुझे तकलीफ हो रही है",
    "मुझे बुखार है",
    "उल्टी हो रही है",
    "बहुत कमजोरी लग रही है",
    "वहां सूजन है",
  ])("flags %j as distress", (text) => {
    expect(detectTextEmotionLexicon(text).label).toBe("distress");
  });

  it.each(["मैं बहुत परेशान हूं", "मुझे घबराहट हो रही है"])("flags %j as fear", (text) => {
    expect(detectTextEmotionLexicon(text).label).toBe("fear");
  });

  it.each(["मुझे समझ नहीं आ रहा", "पता नहीं क्या करूं"])("flags %j as confusion", (text) => {
    expect(detectTextEmotionLexicon(text).label).toBe("confusion");
  });

  it.each(["बहुत शुक्रिया डॉक्टर", "धन्यवाद आपका"])("flags %j as gratitude", (text) => {
    expect(detectTextEmotionLexicon(text).label).toBe("gratitude");
  });

  // SAFETY CRITICAL — same severity class as BUG-E14/BUG-E18.
  it.each(["मेरा मरने का मन करता है", "मैं जीना नहीं चाहता", "खुद को खत्म करना चाहता हूं"])(
    "flags %j (self-harm in Devanagari) as distress",
    (text) => {
      const sig = detectTextEmotionLexicon(text);
      expect(sig.label).toBe("distress");
      expect(sig.intensity).toBeGreaterThan(0.5);
    }
  );

  it("does not match a substring inside a longer, unrelated Devanagari word", () => {
    // "दर्दनाक" (painful, an adjective) contains "दर्द" (pain) as a
    // substring — the custom boundary must not let that bleed through
    // into matching inside a different word.
    const sig = detectTextEmotionLexicon("यह एक दर्दनाक कहानी है"); // "this is a painful story" — not a symptom report
    // Not asserting a specific label here (this sentence has no other
    // signal either way) — only that it isn't scored via a false substring hit.
    expect(sig.matchedKeywords).not.toContain("दर्द");
  });
});
