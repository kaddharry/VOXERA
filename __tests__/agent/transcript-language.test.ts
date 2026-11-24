import { describe, it, expect, vi, beforeEach } from "vitest";

const generateReply = vi.fn();
vi.mock("../../lib/agent/llm", () => ({ generateReply: (...a: unknown[]) => generateReply(...a) }));

import { analyzeTranscriptLanguage, isMixedScriptEnglish, normalizeTranscript } from "../../lib/agent/transcript-language";

beforeEach(() => generateReply.mockReset());

describe("analyzeTranscriptLanguage", () => {
  it.each([
    ["yes I am Hardik", "english"],
    ["I would like to book an appointment tomorrow", "english"],
    ["मेरा नाम हार्दिक है", "hindi"],
    ["mera naam Hardik hai aur mujhe dard ho raha hai", "hinglish"],
    ["ਮੇਰਾ ਨਾਮ ਹਰਦੀਪ ਹੈ", "punjabi"],
    ["आई एम नॉट फीलिंग गुड", "english"],
  ])("%s -> %s", (text, expected) => {
    expect(analyzeTranscriptLanguage(text)).toBe(expected);
  });
});

describe("isMixedScriptEnglish", () => {
  it("catches English split across scripts", () => {
    expect(isMixedScriptEnglish("yes आई एम हार्दिक")).toBe(true);
  });
  it("leaves real Hindi, code-mixed Hindi and plain English alone", () => {
    expect(isMixedScriptEnglish("मेरा नाम हार्दिक है")).toBe(false);
    expect(isMixedScriptEnglish("मेरा appointment कल है")).toBe(false);
    expect(isMixedScriptEnglish("yes I am Hardik")).toBe(false);
  });
});

describe("normalizeTranscript", () => {
  it("rewrites a split-script English sentence into English", async () => {
    generateReply.mockResolvedValue({ text: "Yes, I am Hardik." });
    expect(await normalizeTranscript("yes आई एम हार्दिक")).toBe("Yes, I am Hardik.");
    expect(generateReply).toHaveBeenCalledOnce();
  });
  it("does not call the model for ordinary transcripts", async () => {
    expect(await normalizeTranscript("मेरा नाम हार्दिक है")).toBe("मेरा नाम हार्दिक है");
    expect(await normalizeTranscript("yes I am Hardik")).toBe("yes I am Hardik");
    expect(generateReply).not.toHaveBeenCalled();
  });
  it("keeps the original text when the model fails or answers in the wrong script", async () => {
    generateReply.mockRejectedValueOnce(new Error("quota"));
    expect(await normalizeTranscript("yes आई एम सुरेश")).toBe("yes आई एम सुरेश");
    generateReply.mockResolvedValueOnce({ text: "हाँ मैं सुरेश हूँ" });
    expect(await normalizeTranscript("yes आई एम रमेश")).toBe("yes आई एम रमेश");
  });
});
