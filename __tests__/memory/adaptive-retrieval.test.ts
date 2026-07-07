import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
  calculateDecayedImportance, 
  calculateUpdatedImportanceOnRetrieval,
  generateExplanation,
  groupMemoriesIntoTimeline,
  retrieve
} from "../../lib/memory/retrieval";
import type { MemoryRecord, EmotionContext } from "../../lib/types";

// Mock store and embed helpers
vi.mock("../../lib/memory/store", () => ({
  vectorStore: {
    search: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
  }
}));

vi.mock("../../lib/util/embed", () => ({
  embed: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
}));

vi.mock("../../lib/memory/stm", () => ({
  stm: {
    get: vi.fn().mockResolvedValue([]),
  }
}));

describe("Adaptive Memory Scoring & Decay", () => {
  const baseRecord: MemoryRecord = {
    id: "mem-1",
    tier: "MTM",
    userId: "user_42",
    clientId: "acme-telecom",
    ts: Date.now(),
    text: "Ordinary detail about standard user issue",
    summary: "Standard detail",
    entities: [],
    topic: "general",
    emotion: "neutral",
    vad: { v: 0.5, a: 0.5, d: 0.5 },
    intensity: 0.2,
    importance: 0.5,
    importance_score: 0.5,
    retrieval_count: 0,
    embedding: [],
    sourceUtteranceIds: [],
    recurrence: 1,
    resolved: false
  };

  it("calculates decayed score correctly over time (7-day half-life)", () => {
    // 0 days ago (no decay)
    const freshRecord = { ...baseRecord, ts: Date.now() };
    expect(calculateDecayedImportance(freshRecord)).toBeCloseTo(0.5, 2);

    // 7 days ago (should decay to exactly half of initial 0.5 = 0.25)
    const sevenDaysAgo = Date.now() - (1000 * 60 * 60 * 24 * 7);
    const decayedRecord = { ...baseRecord, ts: sevenDaysAgo };
    expect(calculateDecayedImportance(decayedRecord)).toBeCloseTo(0.25, 2);
  });

  it("respects preservation floors for critical memories", () => {
    const sevenDaysAgo = Date.now() - (1000 * 60 * 60 * 24 * 7);

    // Case 1: LTM_user memory (should decay to floor of max(0.7, base) = 0.7)
    const ltmRecord: MemoryRecord = { 
      ...baseRecord, 
      tier: "LTM_user", 
      importance: 0.6, 
      importance_score: 0.6, 
      ts: sevenDaysAgo 
    };
    expect(calculateDecayedImportance(ltmRecord)).toBe(0.7);

    // Case 2: Allergies keyword match (should decay to floor of 0.7)
    const allergyRecord: MemoryRecord = { 
      ...baseRecord, 
      text: "User is allergic to peanuts", 
      importance: 0.5, 
      importance_score: 0.5, 
      ts: sevenDaysAgo 
    };
    expect(calculateDecayedImportance(allergyRecord)).toBe(0.7);

    // Case 3: Trivial memory (should decay freely towards floor 0.15)
    const thirtyDaysAgo = Date.now() - (1000 * 60 * 60 * 24 * 30);
    const trivialRecord: MemoryRecord = { 
      ...baseRecord, 
      ts: thirtyDaysAgo 
    };
    expect(calculateDecayedImportance(trivialRecord)).toBe(0.15);
  });

  it("adds retrieval usage boost logarithmically", () => {
    const record = { ...baseRecord, retrieval_count: 0 };
    // After 1st retrieval, next count is 1. Boost = 0.05 * ln(2) = ~0.0346
    const boosted = calculateUpdatedImportanceOnRetrieval(record);
    expect(boosted).toBeCloseTo(0.535, 2);
  });
});

describe("Retrieval Explainability", () => {
  const baseRecord: MemoryRecord = {
    id: "mem-2",
    tier: "MTM",
    userId: "user_42",
    clientId: "acme-telecom",
    ts: Date.now(),
    text: "Peanut allergy",
    summary: "Allergy",
    entities: [],
    topic: "general",
    emotion: "neutral",
    vad: { v: 0.5, a: 0.5, d: 0.5 },
    intensity: 0.1,
    importance: 0.8,
    importance_score: 0.8,
    retrieval_count: 2,
    embedding: [],
    sourceUtteranceIds: [],
    recurrence: 1,
    resolved: false
  };

  const mockEmotion: EmotionContext = {
    current: { label: "neutral", intensity: 0, confidence: 1, vad: { v: 0.5, a: 0.5, d: 0.5 }, source: "text", at: Date.now() },
    trajectory: { slope_v: 0, slope_a: 0, window: 5 },
    zDeviation: 0,
    flags: { repeated_frustration: false, increasing_distress: false, affect_oscillation: false, chronic_negativity: false },
    baseline: { v: 0.5, a: 0.5, d: 0.5, sigma_v: 0.1, sigma_a: 0.1, sigma_d: 0.1 }
  };

  it("generates natural-language reason matching score metrics", () => {
    const explanation = generateExplanation(baseRecord, 0.9, mockEmotion, [], false, 0.85);
    expect(explanation.reason).toContain("strong semantic similarity");
    expect(explanation.reason).toContain("critical fact preservation");
    expect(explanation.reason).toContain("frequently accessed");
    expect(explanation.metrics.similarity).toBeCloseTo(0.95, 2); // (0.9+1)/2
    expect(explanation.metrics.importance).toBe(0.8);
    expect(explanation.metrics.retrievalFrequency).toBe(2);
  });
});

describe("Timeline-based Memory Grouping", () => {
  const now = Date.now();
  const dayMs = 1000 * 60 * 60 * 24;

  it("groups user memories of same topic within 48 hours into single timeline events", () => {
    const mem1: MemoryRecord = {
      id: "m1", tier: "MTM", userId: "u", clientId: "c", text: "", entities: [],
      ts: now, topic: "billing", emotion: "neutral", vad: { v: 0.5, a: 0.5, d: 0.5 },
      intensity: 0, importance: 0.5, importance_score: 0.5, retrieval_count: 0, embedding: [],
      sourceUtteranceIds: [], recurrence: 1, resolved: false, summary: "Disputed 50 dollar charge"
    };
    const mem2: MemoryRecord = {
      id: "m2", tier: "MTM", userId: "u", clientId: "c", text: "", entities: [],
      ts: now - dayMs, topic: "billing", emotion: "neutral", vad: { v: 0.5, a: 0.5, d: 0.5 },
      intensity: 0, importance: 0.5, importance_score: 0.5, retrieval_count: 0, embedding: [],
      sourceUtteranceIds: [], recurrence: 1, resolved: false, summary: "Billing system error"
    };
    const mem3: MemoryRecord = {
      id: "m3", tier: "MTM", userId: "u", clientId: "c", text: "", entities: [],
      ts: now - 5 * dayMs, topic: "billing", emotion: "neutral", vad: { v: 0.5, a: 0.5, d: 0.5 },
      intensity: 0, importance: 0.5, importance_score: 0.5, retrieval_count: 0, embedding: [],
      sourceUtteranceIds: [], recurrence: 1, resolved: false, summary: "Initial invoice query"
    };

    const grouped = groupMemoriesIntoTimeline([mem1, mem2, mem3]);
    
    // Should split into 2 events:
    // Event 1 (billing): m1 + m2 (diff of 1 day <= 2 days)
    // Event 2 (billing): m3 (diff of 4 days > 2 days)
    expect(grouped).toHaveLength(2);
    
    // Sort orders: most recent event first
    expect(grouped[0].memories).toHaveLength(2);
    expect(grouped[0].memories.map(m => m.id)).toContain("m1");
    expect(grouped[0].memories.map(m => m.id)).toContain("m2");
    expect(grouped[0].summary).toContain("Disputed 50 dollar charge");
    expect(grouped[0].summary).toContain("Billing system error");
    
    expect(grouped[1].memories).toHaveLength(1);
    expect(grouped[1].memories[0].id).toBe("m3");
  });
});

describe("retrieve() Integration", () => {
  const mockEmotion: EmotionContext = {
    current: { label: "neutral", intensity: 0, confidence: 1, vad: { v: 0.5, a: 0.5, d: 0.5 }, source: "text", at: Date.now() },
    trajectory: { slope_v: 0, slope_a: 0, window: 5 },
    zDeviation: 0,
    flags: { repeated_frustration: false, increasing_distress: false, affect_oscillation: false, chronic_negativity: false },
    baseline: { v: 0.5, a: 0.5, d: 0.5, sigma_v: 0.1, sigma_a: 0.1, sigma_d: 0.1 }
  };

  it("successfully retrieves, ranks, explains, and timelines candidate memories", async () => {
    const { vectorStore } = await import("../../lib/memory/store");

    const mockMem: MemoryRecord = {
      id: "matched-mem-1",
      tier: "MTM",
      userId: "user_42",
      clientId: "acme-telecom",
      ts: Date.now(),
      text: "User requested a custom router installation.",
      summary: "Wants router install",
      entities: [],
      topic: "setup",
      emotion: "neutral",
      vad: { v: 0.5, a: 0.5, d: 0.5 },
      intensity: 0.1,
      importance: 0.6,
      importance_score: 0.6,
      retrieval_count: 0,
      embedding: new Array(1536).fill(0.1),
      sourceUtteranceIds: [],
      recurrence: 1,
      resolved: false
    };

    // Mock search method to return MTM candidate
    vi.mocked(vectorStore.search).mockImplementation(async (args: any) => {
      if (args.tier === "MTM") {
        return [{ rec: mockMem, sim: 0.8 }];
      }
      return [];
    });

    const result = await retrieve({
      sessionId: "test-session",
      userId: "user_42",
      clientId: "acme-telecom",
      queryText: "router installation request",
      emotion: mockEmotion
    });

    // Check payload structure
    expect(result.mtm).toHaveLength(1);
    expect(result.mtm[0].id).toBe("matched-mem-1");
    expect(result.scores).toHaveLength(1);
    expect(result.scores[0].id).toBe("matched-mem-1");
    
    // Check explanation generation
    expect(result.explanations).toBeDefined();
    expect(result.explanations?.["matched-mem-1"]).toBeDefined();
    expect(result.explanations?.["matched-mem-1"].reason).toContain("semantic similarity");
    
    // Check timeline events grouping
    expect(result.timeline).toBeDefined();
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline?.[0].topic).toBe("setup");
    expect(result.timeline?.[0].summary).toBe("Wants router install");

    // Verify vectorStore.update was called to increment retrieval count and update importance_score
    expect(vectorStore.update).toHaveBeenCalledWith("matched-mem-1", expect.objectContaining({
      retrieval_count: 1,
      importance_score: expect.any(Number)
    }));
  });
});
