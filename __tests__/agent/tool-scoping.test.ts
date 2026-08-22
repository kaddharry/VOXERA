/**
 * Reservation tools (check/create/modify/cancel_booking) are a single
 * global TOOLS array with no per-agent scoping — every custom Agent Builder
 * agent used to get the exact same restaurant-booking tools as the
 * hardcoded demo agent, regardless of what that business actually does.
 * Live-reproduced: a resume agent, given a question it had no grounding to
 * answer, called create_booking with fabricated customer data. Custom
 * agents have no booking system built for their tenants at all, so tools
 * are now restricted to the hardcoded demo path only (orchestrator.ts's
 * `useTools: !resolvedAgent`).
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

const mockGetAgentWithTenant = vi.fn();
vi.mock("../../lib/db/agents", () => ({
  getAgentWithTenant: (...args: any[]) => mockGetAgentWithTenant(...args),
}));

const mockGenerateReply = vi.fn();
vi.mock("../../lib/agent/llm", () => ({
  generateReply: (...args: any[]) => mockGenerateReply(...args),
}));

import { handleTurn } from "../../lib/agent/orchestrator";

describe("Tool access is scoped to the hardcoded demo agent, not custom agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateReply.mockResolvedValue({ text: "A reply.", model: "test-model", usedLive: true, provider: "test" });
  });

  it("enables tools for the hardcoded demo path (no agentId)", async () => {
    await handleTurn({
      sessionId: "s1",
      userId: "u1",
      clientId: "demo-client",
      transcript: "Book me a table for two at 7pm",
      sttConfidence: 0.9,
    });

    expect(mockGenerateReply).toHaveBeenCalledTimes(1);
    expect(mockGenerateReply.mock.calls[0][0].useTools).not.toBe(false);
  });

  it("disables tools for a resolved custom Agent Builder agent", async () => {
    mockGetAgentWithTenant.mockResolvedValue({
      id: "agent-1",
      tenant_id: "tenant-1",
      tenant_auth_user_id: "tenant-auth-1",
      name: "Vikas Verma",
      type: "custom",
      status: "active",
      description: null,
      system_prompt: "You are Vikas Verma, speaking about your resume.",
      greeting: null,
      voice_persona: "female-friendly",
      created_at: "",
      updated_at: "",
    });

    await handleTurn({
      sessionId: "s2",
      userId: "u2",
      clientId: "whatever-client",
      agentId: "agent-1",
      transcript: "Why should we hire you?",
      sttConfidence: 0.9,
    });

    expect(mockGenerateReply).toHaveBeenCalledTimes(1);
    expect(mockGenerateReply.mock.calls[0][0].useTools).toBe(false);
  });

  it("still enables tools if agent resolution fails (falls back to the demo path)", async () => {
    mockGetAgentWithTenant.mockResolvedValue(null);

    await handleTurn({
      sessionId: "s3",
      userId: "u3",
      clientId: "whatever-client",
      agentId: "agent-does-not-exist",
      transcript: "Book me a table",
      sttConfidence: 0.9,
    });

    expect(mockGenerateReply).toHaveBeenCalledTimes(1);
    expect(mockGenerateReply.mock.calls[0][0].useTools).not.toBe(false);
  });
});
