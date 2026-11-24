import { describe, it, expect } from "vitest";
import { buildLLMContext } from "../../lib/agent/context";

const base = {
  userId: "u", clientId: "c",
  userTurn: { id: "t", role: "user" as const, text: "Hello", ts: 1 },
  retrieved: { stm: [], mtm: [], ltmUser: [], ltmClient: [], scores: [] } as any,
  emotion: { current: { label: "neutral", intensity: 0, confidence: 0.5, vad: { v: 0, a: 0, d: 0 }, source: "text", at: 1 }, trajectory: { slope_v: 0, slope_a: 0, window: 0 }, zDeviation: 0, flags: { repeated_frustration: false, increasing_distress: false, affect_oscillation: false, chronic_negativity: false }, baseline: { v: 0, a: 0, d: 0, sigma_v: 0.3, sigma_a: 0.3, sigma_d: 0.3 } } as any,
  policy: { acknowledgeFirst: false, pace: "normal", allowUpsell: false, escalate: "none", notes: [] } as any,
};

describe("caller name rule", () => {
  it("tells the agent never to guess a caller's name", () => {
    const { system } = buildLLMContext(base);
    expect(system).toContain("NEVER INVENT THE CALLER'S NAME");
  });
  it("still allows a name that is in PATIENT CONTEXT", () => {
    const { system } = buildLLMContext({ ...base, patientContext: "Patient: Riva Sharma, condition: knee pain" });
    expect(system).toContain("Riva Sharma");
    expect(system).toContain("PATIENT CONTEXT");
  });
});
