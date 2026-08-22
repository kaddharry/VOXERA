/**
 * When a call is placed against a roster patient (lib/db/patients.ts, via
 * the Patients page's "Call Now"), the orchestrator should resolve that
 * patient's `notes` and inject them into the system prompt as a "PATIENT
 * CONTEXT" block (lib/agent/context.ts) — additive grounding, same
 * treatment as an agent's custom_instructions, never a replacement for
 * CORE RULES.
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

const mockGetPatientById = vi.fn();
vi.mock("../../lib/db/patients", () => ({
  getPatientById: (...args: any[]) => mockGetPatientById(...args),
}));

const mockGenerateReply = vi.fn();
vi.mock("../../lib/agent/llm", () => ({
  generateReply: (...args: any[]) => mockGenerateReply(...args),
}));

import { handleTurn } from "../../lib/agent/orchestrator";

describe("Patient context injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateReply.mockResolvedValue({ text: "A reply.", model: "test-model", usedLive: true, provider: "test" });
  });

  it("injects the patient's notes into the system prompt as PATIENT CONTEXT when patientId resolves", async () => {
    mockGetPatientById.mockResolvedValue({
      id: "pat-1",
      clientId: "client-1",
      name: "Alex Rivera",
      phone: "+15550192244",
      notes: "Tibia fracture surgery 4 days ago, marathon runner, watch for DVT red flags.",
      assignedAgentId: null,
      nextCheckInAt: null,
      createdAt: Date.now(),
    });

    await handleTurn({
      sessionId: "s1",
      userId: "u1",
      clientId: "client-1",
      patientId: "pat-1",
      transcript: "How am I doing?",
      sttConfidence: 0.9,
    });

    expect(mockGetPatientById).toHaveBeenCalledWith(expect.anything(), "pat-1");
    expect(mockGenerateReply).toHaveBeenCalledTimes(1);
    const systemPrompt = mockGenerateReply.mock.calls[0][0].system;
    expect(systemPrompt).toContain("=== PATIENT CONTEXT");
    expect(systemPrompt).toContain("Tibia fracture surgery 4 days ago");
  });

  it("omits PATIENT CONTEXT entirely when no patientId is given", async () => {
    await handleTurn({
      sessionId: "s2",
      userId: "u2",
      clientId: "client-1",
      transcript: "Hello",
      sttConfidence: 0.9,
    });

    expect(mockGetPatientById).not.toHaveBeenCalled();
    const systemPrompt = mockGenerateReply.mock.calls[0][0].system;
    expect(systemPrompt).not.toContain("=== PATIENT CONTEXT");
  });

  it("degrades gracefully (no crash, no PATIENT CONTEXT) when the patient lookup fails", async () => {
    mockGetPatientById.mockRejectedValue(new Error("db unreachable"));

    await expect(
      handleTurn({
        sessionId: "s3",
        userId: "u3",
        clientId: "client-1",
        patientId: "pat-missing",
        transcript: "Hello",
        sttConfidence: 0.9,
      })
    ).resolves.toBeDefined();

    const systemPrompt = mockGenerateReply.mock.calls[0][0].system;
    expect(systemPrompt).not.toContain("=== PATIENT CONTEXT");
  });
});
