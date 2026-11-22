import { describe, it, expect } from "vitest";
import { isReasoningClause, isWrongIndicScript, stripForeignScript, stripReasoningLeak, stripWrappingQuotes } from "../../lib/agent/reply-hygiene";
import { sanitizeReply } from "../../lib/agent/llm";
import { ClauseChunker } from "../../lib/agent/clause-chunker";

describe("reply-hygiene: model thinking never reaches the caller", () => {
  it.each([
    "The caller is confused and hasn't provided identification info yet.",
    "I need to repeat my previous question more simply, in Hinglish matching their register, with shorter sentences.",
    "The policy says shorter turns, one question at a time, confirm understanding.",
    "I need to clarify the caller's identity and context before proceeding.",
    "This is a brief goodbye, not a question. I should keep it short in the same language (Hindi).",
    "My response should be short and warm.",
    "<think>hmm</think>",
  ])("flags planning text: %s", (t) => {
    expect(isReasoningClause(t)).toBe(true);
  });

  it.each([
    "I need to ask you a quick question about your medicine.",
    "Let me check the available slots for you.",
    "आपका फॉलो-अप अपॉइंटमेंट कल सुबह दस बजे है।",
    "Haan ji, main aapki appointment dekh rahi hoon.",
    "The doctor will see you on Monday.",
  ])("leaves real speech alone: %s", (t) => {
    expect(isReasoningClause(t)).toBe(false);
  });

  it("keeps only the quoted answer after a plan", () => {
    const raw = `The caller is confused. I need to repeat more simply.\n\n"माफ़ कीजिए, मैं फिर से बताती हूँ। आपका अपॉइंटमेंट कल है।"`;
    expect(stripReasoningLeak(raw)).toBe("माफ़ कीजिए, मैं फिर से बताती हूँ। आपका अपॉइंटमेंट कल है।");
  });

  it("removes <think> blocks, including a dangling close tag", () => {
    expect(sanitizeReply("<think>plan plan</think>नमस्ते!")).toBe("नमस्ते!");
    expect(sanitizeReply("plan plan</think>नमस्ते!")).toBe("नमस्ते!");
  });

  it("strips wrapping quotes and labels", () => {
    expect(stripWrappingQuotes('"Hello there."')).toBe("Hello there.");
    expect(stripWrappingQuotes("Final answer: नमस्ते")).toBe("नमस्ते");
  });
});

describe("ClauseChunker: Devanagari danda ends a sentence", () => {
  it("emits a Hindi sentence at ।", () => {
    const c = new ClauseChunker();
    expect(c.push("नमस्ते, आप कैसे हैं। मैं ठीक हूँ। ")).toEqual(["नमस्ते, आप कैसे हैं।", "मैं ठीक हूँ।"]);
  });
});

import { detectCallerLanguage } from "../../lib/agent/context";
describe("detectCallerLanguage", () => {
  it.each([
    ["I want to book a follow up appointment for tomorrow morning.", "English"],
    ["Mujhe kal 11 baje ka appointment chahiye", "Hinglish (Roman letters)"],
    ["मुझे सिर में दर्द है।", "Hindi (Devanagari)"],
    ["मला थोडं पोट दुखतंय, मी काय करू?", "Marathi (Devanagari)"],
    ["எனக்கு காய்ச்சல் இருக்கிறது", "Tamil (Tamil script)"],
    ["నాకు కడుపు నొప్పిగా ఉంది", "Telugu (Telugu script)"],
    ["আমার মাথা ব্যথা করছে", "Bengali (Bengali script)"],
    ["ਮੈਨੂੰ ਸਿਰ ਦਰਦ ਹੈ", "Punjabi (Gurmukhi script)"],
  ])("%s -> %s", (text, expected) => {
    expect(detectCallerLanguage(text)).toBe(expected);
  });
});

describe("reply-hygiene: script guards", () => {
  it("flags a Hindi reply to a Bengali caller, not a matching one", () => {
    expect(isWrongIndicScript("नमस्ते, सुनकर खुशी हुई।", "Bengali")).toBe(true);
    expect(isWrongIndicScript("নমস্কার, শুনে ভালো লাগলো!", "Bengali")).toBe(false);
  });
  it("never flags English/Hinglish callers, digits or Latin text", () => {
    expect(isWrongIndicScript("नमस्ते, सुनकर खुशी हुई।", "Hinglish")).toBe(false);
    expect(isWrongIndicScript("नमस्ते", undefined)).toBe(false);
    expect(isWrongIndicScript("OK 10", "Bengali")).toBe(false);
  });
  it("strips stray Korean/Chinese/Cyrillic words but keeps Indic text", () => {
    expect(stripForeignScript("પાણી 많이 પીવો")).toBe("પાણી પીવો");
    expect(stripForeignScript("તાવ માટે આરામ કરો")).toBe("તાવ માટે આરામ કરો");
  });
});
