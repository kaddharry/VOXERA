import { describe, it, expect } from "vitest";
import { buildLLMContext } from "../../lib/agent/context";
import type { EmotionContext, PolicyDirectives, RetrievedContext, Utterance } from "../../lib/types";

function makeEmotion(): EmotionContext {
  return {
    current: { label: "neutral", intensity: 0, confidence: 0.8, vad: { v: 0, a: 0, d: 0 }, source: "text", at: Date.now() },
    trajectory: { slope_v: 0, slope_a: 0, window: 0 },
    zDeviation: 0,
    flags: { repeated_frustration: false, increasing_distress: false, affect_oscillation: false, chronic_negativity: false },
    baseline: { v: 0, a: 0, d: 0, sigma_v: 0.3, sigma_a: 0.3, sigma_d: 0.3 },
  };
}

function makeRetrieved(): RetrievedContext {
  return { stm: [], mtm: [], ltmUser: [], ltmClient: [], scores: [] };
}

function makePolicy(): PolicyDirectives {
  return { acknowledgeFirst: false, pace: "normal", allowUpsell: true, escalate: "none", notes: [] };
}

function makeTurn(text: string): Utterance {
  return { id: "u1", role: "user", text, ts: Date.now() };
}

describe("buildLLMContext — Agent Builder customInstructions injection", () => {
  it("includes the agent's custom prompt in the system message when provided", () => {
    const ctx = buildLLMContext({
      userId: "u1",
      clientId: "c1",
      userTurn: makeTurn("Hello"),
      retrieved: makeRetrieved(),
      emotion: makeEmotion(),
      policy: makePolicy(),
      customInstructions: "You are Bella, a concierge for a boutique hotel. Always mention checkout is at noon.",
    });
    expect(ctx.system).toContain("AGENT-SPECIFIC INSTRUCTIONS");
    expect(ctx.system).toContain("You are Bella, a concierge for a boutique hotel.");
    expect(ctx.system).toContain("they never override the CORE RULES");
  });

  it("omits the custom-instructions block entirely when none is provided", () => {
    const ctx = buildLLMContext({
      userId: "u1",
      clientId: "c1",
      userTurn: makeTurn("Hello"),
      retrieved: makeRetrieved(),
      emotion: makeEmotion(),
      policy: makePolicy(),
    });
    expect(ctx.system).not.toContain("AGENT-SPECIFIC INSTRUCTIONS");
  });

  it("omits the block for a blank/whitespace-only custom prompt", () => {
    const ctx = buildLLMContext({
      userId: "u1",
      clientId: "c1",
      userTurn: makeTurn("Hello"),
      retrieved: makeRetrieved(),
      emotion: makeEmotion(),
      policy: makePolicy(),
      customInstructions: "   ",
    });
    expect(ctx.system).not.toContain("AGENT-SPECIFIC INSTRUCTIONS");
  });
});

describe("buildLLMContext — the budget cut never eats the current turn", () => {
  // Regression test for a real production bug: a custom agent with a long
  // system_prompt (7696 chars observed live) already exceeded the old
  // 6000-char BUDGET_CHARS on the system block alone. The old truncation
  // logic sliced the whole assembled `user` string from the end, and since
  // "=== CURRENT TURN ===" was the LAST section in that string, it got cut
  // away first — the caller's actual question and all retrieved evidence
  // vanished, leaving the model nothing to respond to but the system
  // prompt, which is why it answered every question with content-free
  // small talk regardless of what was asked (verified live against the
  // real failing agent/query).
  it("keeps the caller's question intact even when the system prompt alone would blow the whole budget", () => {
    const hugeCustomInstructions = "You are a detailed persona. ".repeat(400); // ~11,600 chars — bigger than BUDGET_CHARS by itself
    const question = "Can you tell me about your experience at Tredence?";
    const ctx = buildLLMContext({
      userId: "u1",
      clientId: "c1",
      userTurn: makeTurn(question),
      retrieved: makeRetrieved(),
      emotion: makeEmotion(),
      policy: makePolicy(),
      customInstructions: hugeCustomInstructions,
    });
    expect(ctx.user).toContain("=== CURRENT TURN ===");
    expect(ctx.user).toContain(question);
  });

  it("keeps the current turn intact even with both a huge system prompt AND a lot of retrieved evidence", () => {
    const hugeCustomInstructions = "You are a detailed persona. ".repeat(400);
    const question = "What are your technical skills?";
    const bigRetrieved: RetrievedContext = {
      stm: [],
      mtm: Array.from({ length: 10 }, (_, i) => ({
        id: `mem-${i}`,
        tier: "MTM" as const,
        userId: "u1",
        clientId: "c1",
        ts: Date.now(),
        text: "Detailed resume content describing a project or role. ".repeat(20),
        summary: "A resume chunk.",
        entities: [],
        topic: "resume",
        emotion: "neutral" as const,
        vad: { v: 0, a: 0, d: 0 },
        intensity: 0,
        importance: 0.8,
        importance_score: 0.8,
        retrieval_count: 0,
        embedding: [],
        sourceUtteranceIds: [],
        recurrence: 0,
        resolved: false,
      })),
      ltmUser: [],
      ltmClient: [],
      scores: [],
    };
    const ctx = buildLLMContext({
      userId: "u1",
      clientId: "c1",
      userTurn: makeTurn(question),
      retrieved: bigRetrieved,
      emotion: makeEmotion(),
      policy: makePolicy(),
      customInstructions: hugeCustomInstructions,
    });
    expect(ctx.user).toContain("=== CURRENT TURN ===");
    expect(ctx.user).toContain(question);
  });

  it("never produces a near-empty user message ('...') the way the original bug did", () => {
    const hugeCustomInstructions = "You are a detailed persona. ".repeat(600); // even bigger than BUDGET_CHARS
    const ctx = buildLLMContext({
      userId: "u1",
      clientId: "c1",
      userTurn: makeTurn("Hello, how are you?"),
      retrieved: makeRetrieved(),
      emotion: makeEmotion(),
      policy: makePolicy(),
      customInstructions: hugeCustomInstructions,
    });
    expect(ctx.user.trim()).not.toBe("...");
    expect(ctx.user.length).toBeGreaterThan(20);
  });
});
