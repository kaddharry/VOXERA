/**
 * Real phone calls (lib/telephony/stream-handler.ts) enable diagnostics
 * mode (for the Live Dashboard's per-engine breakdown) but must NEVER let
 * that computation delay when handleTurn() returns — that return gates
 * this.isBusy, i.e. when the system accepts the caller's next sentence.
 * `deferDiagnostics: true` is the guarantee: handleTurn() resolves the
 * instant the reply/guard work is done, full stop, regardless of how long
 * (or whether) the diagnostics promise ever resolves.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/util/embed", () => ({
  embed: vi.fn().mockResolvedValue(new Array(384).fill(0.01)),
  EMBED_DIM: 384,
}));

const mockChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  neq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  upsert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  then: vi.fn().mockImplementation((onfulfilled) => Promise.resolve({ data: [], error: null }).then(onfulfilled)),
};

vi.mock("../../lib/db/supabase", () => ({
  supabase: { from: vi.fn(() => mockChain), rpc: vi.fn().mockResolvedValue({ data: [], error: null }) },
  isSupabaseHealthy: vi.fn().mockReturnValue(true),
  recordSupabaseSuccess: vi.fn(),
  recordSupabaseFailure: vi.fn(),
}));

vi.mock("../../lib/memory/stm", () => ({
  stm: { push: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue([]), clear: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../../lib/knowledge/inline", () => ({
  getInlineKnowledgeBase: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../lib/db/agents", () => ({
  getAgentWithTenant: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../lib/db/patients", () => ({
  getPatientById: vi.fn().mockResolvedValue(null),
}));

const mockGenerateReply = vi.fn();
vi.mock("../../lib/agent/llm", () => ({
  generateReply: (...args: any[]) => mockGenerateReply(...args),
}));

// Never resolves within the test's lifetime — simulates diagnostics being
// arbitrarily slow (or hung). If deferDiagnostics didn't work, awaiting
// this would make handleTurn() hang too.
let diagnosticsResolvers: Array<() => void> = [];
vi.mock("../../lib/emotion/emotion-debug", () => ({
  runDiagnosticEmotion: vi.fn(
    () =>
      new Promise((resolve) => {
        diagnosticsResolvers.push(() => resolve({} as any));
      })
  ),
}));

import { handleTurn } from "../../lib/agent/orchestrator";

describe("deferDiagnostics — real calls never wait on the diagnostics engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    diagnosticsResolvers = [];
    mockGenerateReply.mockResolvedValue({ text: "A reply.", model: "test-model", usedLive: true, provider: "test" });
  });

  it("resolves promptly even while diagnostics is still hung, when deferDiagnostics is set", async () => {
    const resultPromise = handleTurn(
      { sessionId: "s1", userId: "u1", clientId: "client-1", transcript: "Hello", sttConfidence: 0.9, diagnostics: true },
      { deferDiagnostics: true }
    );

    const result = await Promise.race([
      resultPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("handleTurn() did not resolve within 2s — diagnostics is blocking it")), 2000)),
    ]);

    expect((result as any).trace.emotionDiagnostics).toBeUndefined();
    // Diagnostics never actually resolved in this test (deliberately) —
    // confirms the fast path genuinely didn't wait on it, not that it
    // happened to finish quickly by coincidence.
    expect(diagnosticsResolvers.length).toBe(1);
  }, 3000);

  it("without deferDiagnostics, handleTurn() does wait for diagnostics to resolve", async () => {
    const resultPromise = handleTurn(
      { sessionId: "s2", userId: "u2", clientId: "client-1", transcript: "Hello", sttConfidence: 0.9, diagnostics: true },
      {}
    );

    // Give the turn a moment to reach the diagnostics-awaiting point, then
    // resolve it — if handleTurn() weren't actually waiting, this ordering
    // wouldn't matter at all.
    await new Promise((r) => setTimeout(r, 50));
    expect(diagnosticsResolvers.length).toBe(1);
    diagnosticsResolvers[0]();

    const result = await resultPromise;
    expect(result.trace.emotionDiagnostics).toEqual({});
  });
});
