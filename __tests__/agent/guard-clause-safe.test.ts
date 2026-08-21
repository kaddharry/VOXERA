import { describe, it, expect } from "vitest";
import { guardBeforeLLM, guardOpeningClause, cleanClause, guardTrailingClause, guardOutput } from "../../lib/agent/guard";
import type { PolicyDirectives } from "../../lib/types";

const basePolicy: PolicyDirectives = {
  acknowledgeFirst: false,
  pace: "normal",
  allowUpsell: false,
  escalate: "none",
  notes: [],
};

describe("guardBeforeLLM", () => {
  it("blocks and returns a clarification when STT confidence is below threshold — before ever calling the LLM", () => {
    const result = guardBeforeLLM({ sttConfidence: 0.3, minStt: 0.55 });
    expect(result?.blocked).toBe(true);
    expect(result?.deflection).toMatch(/say that once more/i);
  });

  it("returns null (proceed to the LLM) when confidence is sufficient", () => {
    expect(guardBeforeLLM({ sttConfidence: 0.9, minStt: 0.55 })).toBeNull();
  });

  it("matches guardOutput's own gate exactly, so streaming and non-streaming paths agree", () => {
    const streamingGate = guardBeforeLLM({ sttConfidence: 0.3, minStt: 0.55 });
    const wholeTextGate = guardOutput({
      reply: "anything",
      allowedCitations: [],
      policy: basePolicy,
      sttConfidence: 0.3,
      topRetrievalScore: 1,
      minStt: 0.55,
      minRetrieval: 0.4,
    });
    expect(streamingGate?.deflection).toBe(wholeTextGate.cleaned);
  });
});

describe("guardOpeningClause", () => {
  it("injects an acknowledgement as a leading clause when policy requires one and the first clause lacks it", () => {
    const { leadingClauses, reasons } = guardOpeningClause({
      firstClause: "Your order ships tomorrow.",
      policy: { ...basePolicy, acknowledgeFirst: true },
      topRetrievalScore: 1,
      minRetrieval: 0.4,
      allowedCitations: [],
    });
    expect(leadingClauses).toContain("I'm really sorry this is happening.");
    expect(reasons).toContain("injected acknowledgement (policy)");
  });

  it("does not inject an acknowledgement when the first clause already has one", () => {
    const { leadingClauses } = guardOpeningClause({
      firstClause: "I completely understand — let's fix that.",
      policy: { ...basePolicy, acknowledgeFirst: true },
      topRetrievalScore: 1,
      minRetrieval: 0.4,
      allowedCitations: [],
    });
    expect(leadingClauses).toHaveLength(0);
  });

  it("hedges when retrieval score is below threshold and citations exist, regardless of clause wording", () => {
    const { leadingClauses, reasons } = guardOpeningClause({
      firstClause: "Sure thing!",
      policy: basePolicy,
      topRetrievalScore: 0.1,
      minRetrieval: 0.4,
      allowedCitations: ["mem_1"],
    });
    expect(leadingClauses.some((c) => /avoid guessing/i.test(c))).toBe(true);
    expect(reasons).toContain("retrieval below threshold — hedging factual claim");
  });

  it("does not hedge when there are no allowed citations at all", () => {
    const { leadingClauses } = guardOpeningClause({
      firstClause: "Sure thing!",
      policy: basePolicy,
      topRetrievalScore: 0.1,
      minRetrieval: 0.4,
      allowedCitations: [],
    });
    expect(leadingClauses).toHaveLength(0);
  });
});

describe("cleanClause", () => {
  it("strips a citation fence whose MEM_ID isn't in the allowed list", () => {
    const { cleaned } = cleanClause("Per our records [MEM_ID=fake123] you're covered.", ["mem_real"]);
    expect(cleaned).not.toContain("MEM_ID=fake123");
  });

  it("keeps a citation fence whose MEM_ID IS allowed", () => {
    const { cleaned } = cleanClause("Per our records [MEM_ID=mem_real] you're covered.", ["mem_real"]);
    expect(cleaned).toContain("[MEM_ID=mem_real]");
  });

  it("strips a fabricated ticket-looking identifier not present in the grounded citation text", () => {
    const { cleaned, reasons } = cleanClause("Your ticket is INC-99999.", []);
    expect(cleaned).toContain("[unverified reference removed]");
    expect(reasons.some((r) => r.includes("INC-99999"))).toBe(true);
  });
});

describe("guardTrailingClause", () => {
  it("returns a handoff clause when policy requires escalation and nothing spoken so far mentions it", () => {
    const { trailingClause, reasons } = guardTrailingClause({
      fullSpokenText: "I've noted your complaint.",
      policy: { ...basePolicy, escalate: "human" },
    });
    expect(trailingClause).toMatch(/grab someone from the team/i);
    expect(reasons).toContain("appended escalation sentence (policy)");
  });

  it("returns null when the spoken text already mentions a handoff", () => {
    const { trailingClause } = guardTrailingClause({
      fullSpokenText: "Let me connect you with a teammate right away.",
      policy: { ...basePolicy, escalate: "human" },
    });
    expect(trailingClause).toBeNull();
  });

  it("returns null when policy doesn't require escalation", () => {
    const { trailingClause } = guardTrailingClause({
      fullSpokenText: "All set!",
      policy: basePolicy,
    });
    expect(trailingClause).toBeNull();
  });
});
