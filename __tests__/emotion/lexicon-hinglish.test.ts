import { describe, it, expect } from "vitest";
import { detectTextEmotionLexicon } from "../../lib/emotion/detect";

/**
 * BUG-E18: zero Hinglish/romanized-Hindi coverage. Given this app's visible
 * call data is overwhelmingly +91 (Indian) numbers, code-switching — English
 * sentences with Hindi/Hinglish words dropped in — is extremely common
 * patient speech ("doctor, bahut dard ho raha hai"), and reaches the engine
 * as plain Latin-script text regardless of whatever the STT's configured
 * language eventually is. This does NOT fix the deeper issue (the live STT
 * is hardcoded to language: "en" in lib/deepgram/live.ts, so a patient
 * speaking primarily Hindi may not transcribe accurately at all — a
 * separate, bigger, product-level decision, not something a lexicon change
 * can fix). This only covers the code-switching case that already reaches
 * the engine as readable Latin-script text today.
 */
describe("BUG-E18 — Hinglish/romanized Hindi symptom and distress words", () => {
  it.each([
    "doctor bahut dard ho raha hai",
    "mujhe bahut takleef ho rahi hai",
    "bahut dard hai mera",
    "thoda dard hai abhi bhi",
  ])("flags %j as distress", (text) => {
    expect(detectTextEmotionLexicon(text).label).toBe("distress");
  });

  it.each(["main bahut pareshan hoon", "mujhe ghabrahat ho rahi hai"])(
    "flags %j as fear",
    (text) => {
      expect(detectTextEmotionLexicon(text).label).toBe("fear");
    }
  );

  it.each(["mujhe samajh nahi aa raha", "pata nahi kya karu"])(
    "flags %j as confusion",
    (text) => {
      expect(detectTextEmotionLexicon(text).label).toBe("confusion");
    }
  );

  it.each(["bahut shukriya doctor", "dhanyavad aapka"])(
    "flags %j as gratitude",
    (text) => {
      expect(detectTextEmotionLexicon(text).label).toBe("gratitude");
    }
  );

  it.each(["mujhe bukhar hai", "ulti ho rahi hai", "bahut kamzori lag rahi hai", "sujan hai wahan par"])(
    "flags %j (common post-op symptoms) as distress",
    (text) => {
      expect(detectTextEmotionLexicon(text).label).toBe("distress");
    }
  );

  // SAFETY CRITICAL — same severity class as BUG-E14's English fix.
  it.each(["mera marne ka man karta hai", "main jeena nahi chahta", "khud ko khatam karna chahta hoon"])(
    "flags %j (self-harm in Hindi/Hinglish) as distress",
    (text) => {
      const sig = detectTextEmotionLexicon(text);
      expect(sig.label).toBe("distress");
      expect(sig.intensity).toBeGreaterThan(0.5);
    }
  );

  it("does not collide with ordinary English words", () => {
    // "dar" (fear) / "mar" (die/hit) are short Hindi roots — guard against
    // them accidentally matching inside unrelated English words via \b.
    expect(detectTextEmotionLexicon("I parked the car near the market").label).toBe("neutral");
    expect(detectTextEmotionLexicon("darling, how are you today").label).toBe("neutral");
  });
});
