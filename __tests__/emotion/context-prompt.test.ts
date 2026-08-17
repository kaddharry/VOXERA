/**
 * Tests: LLM Context System Prompt — persona injection (lib/agent/context.ts)
 * Sprint 2 — FR-11 Emotion-Aware Response Generation
 *
 * Verifies that the system prompt actually contains the persona content
 * for each emotion state — ensuring the LLM gets the right coaching.
 *
 * Run: npm run test:run
 */

import { describe, it, expect } from "vitest";
import { buildLLMContext } from "../../lib/agent/context";
import type { EmotionContext, EmotionLabel, Utterance, RetrievedContext, PolicyDirectives } from "../../lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEmotion(label: EmotionLabel, intensity = 0.5, flags: Partial<EmotionContext["flags"]> = {}): EmotionContext {
  return {
    current: { label, intensity, confidence: 0.8, vad: { v: 0, a: 0, d: 0 }, source: "text", at: Date.now() },
    trajectory: { slope_v: 0, slope_a: 0, window: 6 },
    zDeviation: 0,
    flags: {
      repeated_frustration: false,
      increasing_distress: false,
      affect_oscillation: false,
      chronic_negativity: false,
      ...flags,
    },
    baseline: { v: 0, a: 0, d: 0, sigma_v: 0.3, sigma_a: 0.3, sigma_d: 0.3 },
  };
}

function makeUtterance(text: string): Utterance {
  return {
    id: "u-001",
    role: "user",
    text,
    ts: Date.now(),
    sttConfidence: 0.95,
  };
}

const emptyRetrieved: RetrievedContext = {
  ltmClient: [],
  ltmUser: [],
  mtm: [],
  stm: [],
  scores: [],
};

const defaultPolicy: PolicyDirectives = {
  acknowledgeFirst: false,
  pace: "normal",
  allowUpsell: true,
  escalate: "none",
  notes: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildLLMContext — system prompt contains persona section", () => {
  it("system prompt contains EMOTIONAL PERSONA header", () => {
    const ctx = buildLLMContext({
      userId: "U-001",
      clientId: "C-001",
      userTurn: makeUtterance("Hello, I need help."),
      retrieved: emptyRetrieved,
      emotion: makeEmotion("neutral"),
      policy: defaultPolicy,
    });
    expect(ctx.system).toContain("EMOTIONAL PERSONA");
  });

  it("system prompt contains CALLER EMOTIONAL STATE", () => {
    const ctx = buildLLMContext({
      userId: "U-001",
      clientId: "C-001",
      userTurn: makeUtterance("I am very upset."),
      retrieved: emptyRetrieved,
      emotion: makeEmotion("anger", 0.82),
      policy: defaultPolicy,
    });
    expect(ctx.system).toContain("CALLER EMOTIONAL STATE (this turn's raw read): ANGER");
  });

  it("system prompt contains intensity value", () => {
    const ctx = buildLLMContext({
      userId: "U-001",
      clientId: "C-001",
      userTurn: makeUtterance("This is terrible!"),
      retrieved: emptyRetrieved,
      emotion: makeEmotion("frustration", 0.75),
      policy: defaultPolicy,
    });
    expect(ctx.system).toContain("0.75");
  });

  it("system prompt contains TONE YOU MUST ADOPT", () => {
    const ctx = buildLLMContext({
      userId: "U-001",
      clientId: "C-001",
      userTurn: makeUtterance("Hi there."),
      retrieved: emptyRetrieved,
      emotion: makeEmotion("joy"),
      policy: defaultPolicy,
    });
    expect(ctx.system).toContain("TONE YOU MUST ADOPT");
  });

  it("system prompt contains LANGUAGE RULES", () => {
    const ctx = buildLLMContext({
      userId: "U-001",
      clientId: "C-001",
      userTurn: makeUtterance("I'm confused."),
      retrieved: emptyRetrieved,
      emotion: makeEmotion("confusion"),
      policy: defaultPolicy,
    });
    expect(ctx.system).toContain("LANGUAGE RULES:");
  });

  it("system prompt contains EXAMPLE OPENING", () => {
    const ctx = buildLLMContext({
      userId: "U-001",
      clientId: "C-001",
      userTurn: makeUtterance("I'm scared about my account."),
      retrieved: emptyRetrieved,
      emotion: makeEmotion("fear"),
      policy: defaultPolicy,
    });
    expect(ctx.system).toContain("EXAMPLE OPENING:");
  });

  it("anger persona — system prompt contains forbidden word mention", () => {
    const ctx = buildLLMContext({
      userId: "U-001",
      clientId: "C-001",
      userTurn: makeUtterance("THIS IS THE THIRD TIME!"),
      retrieved: emptyRetrieved,
      emotion: makeEmotion("anger", 0.9),
      policy: { ...defaultPolicy, acknowledgeFirst: true, pace: "slow" },
    });
    expect(ctx.system).toContain("FORBIDDEN");
    // "policy" is a forbidden word for anger persona
    expect(ctx.system).toContain('"policy"');
  });

  it("distress persona — system prompt contains safety-first language", () => {
    const ctx = buildLLMContext({
      userId: "U-001",
      clientId: "C-001",
      userTurn: makeUtterance("I'm really struggling here."),
      retrieved: emptyRetrieved,
      emotion: makeEmotion("distress", 0.8, { increasing_distress: true }),
      policy: defaultPolicy,
    });
    expect(ctx.system.toLowerCase()).toContain("safety");
  });

  it("persona section appears BEFORE core rules (highest priority)", () => {
    const ctx = buildLLMContext({
      userId: "U-001",
      clientId: "C-001",
      userTurn: makeUtterance("Hello."),
      retrieved: emptyRetrieved,
      emotion: makeEmotion("neutral"),
      policy: defaultPolicy,
    });
    const personaIdx = ctx.system.indexOf("EMOTIONAL PERSONA");
    const coreRulesIdx = ctx.system.indexOf("CORE RULES");
    expect(personaIdx).toBeLessThan(coreRulesIdx);
  });
});

describe("buildLLMContext — user prompt still contains evidence and STM", () => {
  it("user prompt contains EVIDENCE section", () => {
    const ctx = buildLLMContext({
      userId: "U-001",
      clientId: "C-001",
      userTurn: makeUtterance("Hello."),
      retrieved: emptyRetrieved,
      emotion: makeEmotion("neutral"),
      policy: defaultPolicy,
    });
    expect(ctx.user).toContain("=== EVIDENCE ===");
  });

  it("user prompt contains POLICY section", () => {
    const ctx = buildLLMContext({
      userId: "U-001",
      clientId: "C-001",
      userTurn: makeUtterance("Hello."),
      retrieved: emptyRetrieved,
      emotion: makeEmotion("neutral"),
      policy: defaultPolicy,
    });
    expect(ctx.user).toContain("=== POLICY ===");
  });

  it("user prompt contains CURRENT TURN with user text", () => {
    const ctx = buildLLMContext({
      userId: "U-001",
      clientId: "C-001",
      userTurn: makeUtterance("My name is Bob."),
      retrieved: emptyRetrieved,
      emotion: makeEmotion("neutral"),
      policy: defaultPolicy,
    });
    expect(ctx.user).toContain("My name is Bob.");
  });
});
