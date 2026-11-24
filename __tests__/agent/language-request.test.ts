import { describe, it, expect } from "vitest";
import { detectLanguageRequest } from "../../lib/agent/language-request";

describe("detectLanguageRequest", () => {
  it("catches the Devanagari request from the live call", () => {
    expect(detectLanguageRequest("क्या आप इंग्लिश में बात कर सकते हो?")).toBe("english");
  });
  it("catches Latin requests", () => {
    expect(detectLanguageRequest("Can you speak in English please")).toBe("english");
    expect(detectLanguageRequest("hindi me baat karo")).toBe("hindi");
  });
  it("ignores ordinary sentences", () => {
    expect(detectLanguageRequest("No, I'm not feeling good")).toBeNull();
    expect(detectLanguageRequest("मुझे दर्द हो रहा है")).toBeNull();
  });
});

import { looksLikeTransliteratedEnglish } from "../../lib/agent/language-request";
describe("looksLikeTransliteratedEnglish", () => {
  it("flags English spelled in Devanagari / Gujarati", () => {
    expect(looksLikeTransliteratedEnglish("आई आई हैव अ टूथ ऐक।")).toBe(true);
    expect(looksLikeTransliteratedEnglish("ના, આઈ એમ નોટ ફીલિંગ ગુડ.")).toBe(true);
    expect(looksLikeTransliteratedEnglish("ओके, सो बेसिकली आय वाँट टू बुक एन अपॉइंटमेंट विथ द डॉक्टर।")).toBe(true);
  });
  it("leaves real Hindi alone", () => {
    expect(looksLikeTransliteratedEnglish("मुझे दांत में बहुत दर्द हो रहा है")).toBe(false);
    expect(looksLikeTransliteratedEnglish("मैं डॉक्टर से अपॉइंटमेंट लेना चाहता हूँ")).toBe(false);
  });
});
