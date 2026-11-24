import { describe, it, expect } from "vitest";
import { buildLLMContext } from "../../lib/agent/context";

const base = {
  userId: "u", clientId: "c",
  retrieved: { stm: [], mtm: [], ltmUser: [], ltmClient: [], scores: [] } as any,
  emotion: { current: { label: "neutral", intensity: 0, confidence: 0.5, vad: { v: 0, a: 0, d: 0 }, source: "text", at: 1 }, trajectory: { slope_v: 0, slope_a: 0, window: 0 }, zDeviation: 0, flags: { repeated_frustration: false, increasing_distress: false, affect_oscillation: false, chronic_negativity: false }, baseline: { v: 0, a: 0, d: 0, sigma_v: 0.3, sigma_a: 0.3, sigma_d: 0.3 } } as any,
  policy: { acknowledgeFirst: false, pace: "normal", allowUpsell: false, escalate: "none", notes: [] } as any,
  language: "auto",
  speakerGender: "female" as const,
};
const turn = (text: string) => ({ id: "t", role: "user" as const, text, ts: 1 });

describe("language rules size", () => {
  it("an English turn on an auto call gets the SHORT language rules", () => {
    const { system } = buildLLMContext({ ...base, userTurn: turn("I have a little pain in my legs.") });
    expect(system).toContain("=== LANGUAGE");
    expect(system).toContain("English in → English out");
    expect(system).not.toContain("Devanagari is shared by Hindi and Marathi");
    expect(system).toContain("FEMALE");
  });
  it("a Hindi turn still gets the FULL language rules (scripts, genders, Hindi vs Marathi)", () => {
    const { system } = buildLLMContext({ ...base, userTurn: turn("मुझे पैरों में दर्द है।") });
    expect(system).toContain("Devanagari is shared by Hindi and Marathi");
  });
  it("an explicit Hindi call setting keeps the full rules even for a Latin-letter turn", () => {
    const { system } = buildLLMContext({ ...base, language: "hi-IN", userTurn: turn("mujhe dard hai") });
    expect(system).toContain("Devanagari is shared by Hindi and Marathi");
  });
  it("the short version is actually much smaller", () => {
    const short = buildLLMContext({ ...base, userTurn: turn("hello there") }).system.length;
    const full = buildLLMContext({ ...base, userTurn: turn("नमस्ते") }).system.length;
    expect(full - short).toBeGreaterThan(1000);
  });
});
