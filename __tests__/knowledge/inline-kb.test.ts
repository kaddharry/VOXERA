/**
 * Tests: small-KB inline context fast path (lib/knowledge/inline.ts)
 *
 * getInlineKnowledgeBase() lets the orchestrator skip the per-turn
 * LTM_client pgvector search entirely for a client whose whole knowledge
 * base is small enough to just inline into the system prompt — table-driven
 * around CONFIG.knowledge.stackThresholdChunks (20).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CONFIG } from "../../lib/config";

let mockRows: Array<{ text: string; topic: string }> = [];
let mockError: any = null;

vi.mock("../../lib/db/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockImplementation(() => Promise.resolve({ data: mockRows, error: mockError })),
    })),
  },
}));

describe("getInlineKnowledgeBase", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockRows = [];
    mockError = null;
  });

  it("returns null when the client has no knowledge base at all", async () => {
    mockRows = [];
    const { getInlineKnowledgeBase } = await import("../../lib/knowledge/inline");
    expect(await getInlineKnowledgeBase("client-empty")).toBeNull();
  });

  it("returns the concatenated text when chunk count is under the threshold", async () => {
    mockRows = Array.from({ length: 5 }, (_, i) => ({ text: `chunk ${i}`, topic: "kb:menu" }));
    const { getInlineKnowledgeBase } = await import("../../lib/knowledge/inline");
    const result = await getInlineKnowledgeBase("client-small");
    expect(result).not.toBeNull();
    for (let i = 0; i < 5; i++) expect(result).toContain(`chunk ${i}`);
  });

  it("returns the concatenated text when chunk count is exactly at the threshold", async () => {
    mockRows = Array.from({ length: CONFIG.knowledge.stackThresholdChunks }, (_, i) => ({
      text: `chunk ${i}`,
      topic: "kb:menu",
    }));
    const { getInlineKnowledgeBase } = await import("../../lib/knowledge/inline");
    const result = await getInlineKnowledgeBase("client-at-threshold");
    expect(result).not.toBeNull();
    expect(result?.split("\n\n").length).toBe(CONFIG.knowledge.stackThresholdChunks);
  });

  it("returns null when chunk count exceeds the threshold — too large to inline, use RAG", async () => {
    mockRows = Array.from({ length: CONFIG.knowledge.stackThresholdChunks + 1 }, (_, i) => ({
      text: `chunk ${i}`,
      topic: "kb:menu",
    }));
    const { getInlineKnowledgeBase } = await import("../../lib/knowledge/inline");
    expect(await getInlineKnowledgeBase("client-large")).toBeNull();
  });

  it("filters out stack-summary records (topic ending :overview) before counting/inlining", async () => {
    mockRows = [
      { text: "detail 1", topic: "kb:menu" },
      { text: "detail 2", topic: "kb:menu" },
      { text: "an overview summary", topic: "kb:menu:overview" },
    ];
    const { getInlineKnowledgeBase } = await import("../../lib/knowledge/inline");
    const result = await getInlineKnowledgeBase("client-with-overview");
    expect(result).not.toBeNull();
    expect(result).not.toContain("an overview summary");
    expect(result).toContain("detail 1");
    expect(result).toContain("detail 2");
  });

  it("caches the result — a second call within the TTL doesn't re-query", async () => {
    mockRows = [{ text: "chunk 0", topic: "kb:menu" }];
    const { getInlineKnowledgeBase } = await import("../../lib/knowledge/inline");
    const { supabase } = await import("../../lib/db/supabase");

    await getInlineKnowledgeBase("client-cached");
    const callsAfterFirst = (supabase.from as any).mock.calls.length;
    await getInlineKnowledgeBase("client-cached");
    expect((supabase.from as any).mock.calls.length).toBe(callsAfterFirst);
  });

  it("invalidateInlineKnowledgeBase() clears the cache so the next call re-queries", async () => {
    mockRows = [{ text: "chunk 0", topic: "kb:menu" }];
    const { getInlineKnowledgeBase, invalidateInlineKnowledgeBase } = await import("../../lib/knowledge/inline");
    const { supabase } = await import("../../lib/db/supabase");

    await getInlineKnowledgeBase("client-invalidate");
    const callsAfterFirst = (supabase.from as any).mock.calls.length;
    invalidateInlineKnowledgeBase("client-invalidate");
    await getInlineKnowledgeBase("client-invalidate");
    expect((supabase.from as any).mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("returns null on a DB error rather than throwing", async () => {
    mockError = { message: "connection reset" };
    const { getInlineKnowledgeBase } = await import("../../lib/knowledge/inline");
    await expect(getInlineKnowledgeBase("client-error")).resolves.toBeNull();
  });
});
