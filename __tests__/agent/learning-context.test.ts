/**
 * What earlier calls taught us (lib/learning) must reach the live prompt:
 * the orchestrator pulls the patient's + agent's + global learnings and
 * injects them, and a failing or slow learning store must never break a turn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/util/embed", () => ({ embed: vi.fn().mockResolvedValue(new Array(384).fill(0.01)), EMBED_DIM: 384 }));
const chain: any = {};
for (const m of ["select", "eq", "neq", "gte", "not", "in", "order", "limit", "single", "insert", "upsert", "update", "delete"]) chain[m] = vi.fn().mockReturnThis();
chain.then = vi.fn().mockImplementation((f) => Promise.resolve({ data: [], error: null }).then(f));
vi.mock("../../lib/db/supabase", () => ({
  supabase: { from: vi.fn(() => chain), rpc: vi.fn().mockResolvedValue({ data: [], error: null }) },
  isSupabaseHealthy: vi.fn().mockReturnValue(true), recordSupabaseSuccess: vi.fn(), recordSupabaseFailure: vi.fn(),
}));
vi.mock("../../lib/memory/stm", () => ({ stm: { push: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue([]), clear: vi.fn() } }));
vi.mock("../../lib/knowledge/inline", () => ({ getInlineKnowledgeBase: vi.fn().mockResolvedValue(null) }));
vi.mock("../../lib/db/agents", () => ({ getAgentWithTenant: vi.fn().mockResolvedValue(null) }));
vi.mock("../../lib/db/patients", () => ({ getPatientById: vi.fn().mockResolvedValue(null) }));

const mockGenerateReply = vi.fn();
vi.mock("../../lib/agent/llm", () => ({ generateReply: (...a: any[]) => mockGenerateReply(...a) }));

const mockGetLearningContext = vi.fn();
vi.mock("../../lib/learning", () => ({ getLearningContext: (...a: any[]) => mockGetLearningContext(...a), learnFromCall: vi.fn() }));

import { handleTurn } from "../../lib/agent/orchestrator";

const turn = (o: object = {}) => ({ sessionId: "s", userId: "u", clientId: "client-1", transcript: "Hello", sttConfidence: 0.9, ...o });

describe("learning context in the live prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateReply.mockResolvedValue({ text: "A reply.", model: "m", usedLive: true, provider: "t" });
  });

  it("injects what we learned, keyed by this call's patient", async () => {
    mockGetLearningContext.mockResolvedValue("=== WHAT WE ALREADY KNOW ABOUT THIS PATIENT (learned from earlier calls) ===\n- Prefers calls after 6 pm (contact preference, said 2 days ago)");
    await handleTurn(turn({ patientId: "pat-1" }));
    expect(mockGetLearningContext).toHaveBeenCalledWith(expect.objectContaining({ clientId: "client-1", patientId: "pat-1" }));
    const system = mockGenerateReply.mock.calls[0][0].system;
    expect(system).toContain("WHAT WE ALREADY KNOW ABOUT THIS PATIENT");
    expect(system).toContain("Prefers calls after 6 pm");
  });

  it("adds nothing when nothing has been learned", async () => {
    mockGetLearningContext.mockResolvedValue(undefined);
    await handleTurn(turn());
    expect(mockGenerateReply.mock.calls[0][0].system).not.toContain("WHAT WE ALREADY KNOW");
  });

  it("a crashing learning store never breaks the turn", async () => {
    mockGetLearningContext.mockRejectedValue(new Error("db down"));
    await expect(handleTurn(turn({ patientId: "pat-1" }))).resolves.toBeDefined();
    expect(mockGenerateReply).toHaveBeenCalledTimes(1);
  });

  it("a hung learning store is cut off instead of stalling the call", async () => {
    mockGetLearningContext.mockReturnValue(new Promise(() => {}));
    const started = Date.now();
    await handleTurn(turn());
    expect(Date.now() - started).toBeLessThan(2500);
    expect(mockGenerateReply).toHaveBeenCalledTimes(1);
  });
});
