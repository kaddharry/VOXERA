import { describe, it, expect } from "vitest";
import { resolveCallLanguage, turnLanguage, callLanguageLine } from "../../lib/agent/call-language";
import { detectLanguageRequest } from "../../lib/agent/language-request";
import { buildLLMContext } from "../../lib/agent/context";

describe("resolveCallLanguage — the language stays fixed", () => {
  it("first real sentence sets it; short English bits do not switch a Hindi call", () => {
    const s = resolveCallLanguage(["हेलो", "मुझे सिर में बहुत दर्द हो रहा है", "ok", "thank you", "कल डॉक्टर से मिल सकते हैं क्या"]);
    expect(s?.language).toBe("hindi");
    expect(s?.reason).toBe("first");
  });
  it("one full English sentence in a Hindi call does not switch it", () => {
    const s = resolveCallLanguage(["मुझे सिर में बहुत दर्द हो रहा है", "Okay I understand what you are saying"]);
    expect(s?.language).toBe("hindi");
  });
  it("two English sentences in a row do switch it (caller clearly changed language)", () => {
    const s = resolveCallLanguage(["मुझे सिर में बहुत दर्द हो रहा है", "Okay I understand what you are saying", "Can I book a doctor for tomorrow morning"]);
    expect(s).toMatchObject({ language: "english", reason: "switched" });
  });
  it("an explicit request switches at once, and back again", () => {
    expect(resolveCallLanguage(["मुझे बुखार है और खांसी भी", "क्या आप इंग्लिश में बात कर सकते हो?"])).toMatchObject({ language: "english", reason: "asked" });
    expect(resolveCallLanguage(["I have a fever since yesterday", "hindi me baat karo", "ok"])).toMatchObject({ language: "hindi", reason: "asked", script: "roman" });
    expect(resolveCallLanguage(["I have a fever since yesterday", "please speak in Punjabi"])).toMatchObject({ language: "punjabi" });
  });
  it("after asking for English, a Hindi sentence alone does not undo it", () => {
    const s = resolveCallLanguage(["Can you speak in English please", "मुझे बहुत दर्द है अभी भी"]);
    expect(s?.language).toBe("english");
  });
  it("Roman Hinglish counts as Hindi and keeps the Roman script", () => {
    const s = resolveCallLanguage(["mujhe kal se bahut dard ho raha hai"]);
    expect(s).toMatchObject({ language: "hindi", script: "roman" });
  });
  it("English written in Devanagari by STT counts as English", () => {
    expect(turnLanguage("ओके, सो बेसिकली आय वाँट टू बुक एन अपॉइंटमेंट विथ द डॉक्टर।").language).toBe("english");
  });
  it("returns null until a real sentence", () => {
    expect(resolveCallLanguage(["hello", "haan"])).toBeNull();
  });
});

describe("detectLanguageRequest — negation, more languages, identity", () => {
  it("picks the language that is not negated", () => {
    expect(detectLanguageRequest("Hindi nahi, English mein bolo")).toBe("english");
    expect(detectLanguageRequest("English nahi, Hindi mein baat karo")).toBe("hindi");
    expect(detectLanguageRequest("speak in English, not Hindi")).toBe("english");
  });
  it("knows other Indian languages", () => {
    expect(detectLanguageRequest("मराठी में बात कीजिए")).toBe("marathi");
    expect(detectLanguageRequest("can you speak Tamil")).toBe("tamil");
  });
  it("'I am Punjabi' is not a request", () => {
    expect(detectLanguageRequest("main punjabi hoon")).toBeNull();
  });
});

describe("prompt uses the call language", () => {
  const base = {
    userId: "u", clientId: "c",
    retrieved: { stm: [], mtm: [], ltmUser: [], ltmClient: [], scores: [] },
    emotion: {
      current: { label: "neutral", intensity: 0, confidence: 0.8, vad: { v: 0, a: 0, d: 0 }, source: "text", at: 0 },
      trajectory: { slope_v: 0, slope_a: 0, window: 0 },
      zDeviation: 0,
      flags: { repeated_frustration: false, increasing_distress: false, affect_oscillation: false, chronic_negativity: false },
      baseline: { v: 0, a: 0, d: 0, sigma_v: 0.3, sigma_a: 0.3, sigma_d: 0.3 },
    },
    policy: { pace: "normal", acknowledgeFirst: false, allowUpsell: true, escalate: "none", notes: [] },
    language: "auto",
  } as any;
  it("a Hindi call stays Hindi on an English turn", () => {
    const ctx = buildLLMContext({
      ...base,
      userTurn: { id: "t", role: "user", text: "ok I understand that", ts: 0 },
      callLanguage: { language: "hindi", reason: "first", script: "devanagari" },
    });
    expect(ctx.user).toContain("CALLER LANGUAGE THIS TURN: Hindi (Devanagari)");
    expect(ctx.system).not.toContain("English in → English out");
  });
  it("line names the reason", () => {
    expect(callLanguageLine({ language: "english", reason: "asked", script: "roman" })).toMatch(/^CALLER LANGUAGE THIS TURN: English .*asked/);
  });
});
