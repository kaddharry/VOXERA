/** See lib/agent/orchestrator.ts: a turn aborted mid-generation must not leave its canned fallback reply in memory/transcript. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { stm } from "../../lib/memory/stm";

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

describe("a cancelled turn's reply is never remembered as said", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    diagnosticsResolvers = [];
  });

  it("throws AbortError instead of storing llm.ts's canned fallback when the turn was cancelled", async () => {
    const controller = new AbortController();
    // The provider request is aborted (caller kept talking); llm.ts then
    // falls back to its canned reply, as on the live call.
    mockGenerateReply.mockImplementation(async () => {
      controller.abort();
      return { text: "Thanks for letting me know. To make sure I help you correctly, could you tell me a little more?", model: "offline-fallback", usedLive: false, provider: "offline" };
    });

    await expect(
      handleTurn(
        { sessionId: "s1", userId: "u1", clientId: "client-1", transcript: "I'm really worried that something", sttConfidence: 0.9 },
        { abortSignal: controller.signal, deferDiagnostics: true, onReplyChunk: () => {} }
      )
    ).rejects.toMatchObject({ name: "AbortError" });

    const pushed = vi.mocked(stm.push).mock.calls.map((c) => (c[1] as { role: string }).role);
    expect(pushed).toEqual(["user"]);
  });

  it("still stores the reply of a turn that wasn't cancelled", async () => {
    mockGenerateReply.mockResolvedValue({ text: "A reply.", model: "test-model", usedLive: true, provider: "test" });
    await handleTurn(
      { sessionId: "s2", userId: "u2", clientId: "client-1", transcript: "Hello", sttConfidence: 0.9 },
      { abortSignal: new AbortController().signal, deferDiagnostics: true, onReplyChunk: () => {} }
    );
    const pushed = vi.mocked(stm.push).mock.calls.map((c) => (c[1] as { role: string }).role);
    expect(pushed).toEqual(["user", "agent"]);
  });
});
