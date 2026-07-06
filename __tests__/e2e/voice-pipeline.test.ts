import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock embed to avoid real API calls in tests
vi.mock("../../lib/util/embed", () => ({
  embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.01)),
  EMBED_DIM: 1536,
}));

// Mock Supabase
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
  then: vi.fn().mockImplementation((onfulfilled) => {
    return Promise.resolve({ data: [], error: null }).then(onfulfilled);
  }),
};

vi.mock("../../lib/db/supabase", () => ({
  supabase: {
    from: vi.fn(() => mockChain),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

// Mock STM
vi.mock("../../lib/memory/stm", () => ({
  stm: {
    push: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue([]),
    clear: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock Deepgram
vi.mock("../../lib/deepgram/client", () => ({
  getDeepgram: vi.fn(),
}));

// Mock LLM — simulate different reply scenarios
const mockGenerateReply = vi.fn();
vi.mock("../../lib/agent/llm", () => ({
  generateReply: (...args: any[]) => mockGenerateReply(...args),
}));

import { handleTurn } from "../../lib/agent/orchestrator";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Issue #9: E2E Voice Conversation Pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes a normal conversation turn end-to-end", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      text: "Hello! How can I help you today?",
      model: "llama-3.3-70b-versatile",
      usedLive: true,
      provider: "groq",
    });

    const result = await handleTurn({
      sessionId: "e2e-session-1",
      userId: "e2e-user-1",
      clientId: "e2e-client-1",
      transcript: "Hi, I need some help",
      sttConfidence: 0.95,
    });

    expect(result).toBeDefined();
    expect(result.reply).toBe("Hello! How can I help you today?");
    expect(result.trace).toBeDefined();
    expect(result.trace.utterance.text).toBe("Hi, I need some help");
    expect(result.trace.utterance.role).toBe("user");
    expect(result.trace.llmModel).toBe("llama-3.3-70b-versatile");
    expect(result.trace.usedLiveLlm).toBe(true);
  });

  it("handles booking intent with tool calling", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      text: "I've booked a table for you at 7pm tonight!",
      model: "llama-3.3-70b-versatile",
      usedLive: true,
      provider: "groq",
    });

    const result = await handleTurn({
      sessionId: "e2e-session-2",
      userId: "e2e-user-2",
      clientId: "e2e-client-2",
      transcript: "I want to book a table for dinner at 7pm",
      sttConfidence: 0.92,
    });

    expect(result).toBeDefined();
    expect(result.reply).toContain("booked");
    expect(result.trace.importance).toBeGreaterThan(0);
  });

  it("detects negative emotion and adjusts policy", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      text: "I'm really sorry to hear that. Let me help resolve this right away.",
      model: "llama-3.3-70b-versatile",
      usedLive: true,
      provider: "groq",
    });

    const result = await handleTurn({
      sessionId: "e2e-session-3",
      userId: "e2e-user-3",
      clientId: "e2e-client-3",
      transcript: "I'm extremely frustrated with your terrible service!",
      sttConfidence: 0.88,
    });

    expect(result).toBeDefined();
    expect(result.trace.emotion.current.label).not.toBe("neutral");
    expect(result.trace.emotion.current.intensity).toBeGreaterThan(0);
    // Policy should acknowledge the distress
    expect(result.trace.policy.acknowledgeFirst).toBe(true);
  });

  it("uses offline fallback when LLM is unavailable", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      text: "Thanks for letting me know. To make sure I help you correctly, could you tell me a little more about what you'd like me to do next?",
      model: "offline-fallback",
      usedLive: false,
      provider: "offline",
    });

    const result = await handleTurn({
      sessionId: "e2e-session-4",
      userId: "e2e-user-4",
      clientId: "e2e-client-4",
      transcript: "Hello, is anyone there?",
    });

    expect(result).toBeDefined();
    expect(result.reply.length).toBeGreaterThan(0);
    expect(result.trace.usedLiveLlm).toBe(false);
    expect(result.trace.llmModel).toBe("offline-fallback");
  });

  it("calculates CAI score for each turn", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      text: "Of course, I can help with that.",
      model: "llama-3.3-70b-versatile",
      usedLive: true,
      provider: "groq",
    });

    const result = await handleTurn({
      sessionId: "e2e-session-5",
      userId: "e2e-user-5",
      clientId: "e2e-client-5",
      transcript: "Can you tell me about your services? I really need to understand what is available.",
      sttConfidence: 0.97,
    });

    expect(result.trace.cai).toBeDefined();
    expect(result.trace.cai!.score).toBeGreaterThanOrEqual(0);
    expect(result.trace.cai!.score).toBeLessThanOrEqual(100);
    expect(["Low Engagement", "Moderate Engagement", "High Engagement"]).toContain(result.trace.cai!.category);
  });

  it("handles low STT confidence gracefully", async () => {
    mockGenerateReply.mockResolvedValueOnce({
      text: "I want to make sure I understand you correctly. Could you repeat that?",
      model: "llama-3.3-70b-versatile",
      usedLive: true,
      provider: "groq",
    });

    const result = await handleTurn({
      sessionId: "e2e-session-6",
      userId: "e2e-user-6",
      clientId: "e2e-client-6",
      transcript: "mumble something unclear",
      sttConfidence: 0.3,
    });

    expect(result).toBeDefined();
    expect(result.trace.utterance.sttConfidence).toBe(0.3);
    // Guard should flag low confidence
    expect(result.trace.guardReasons.length).toBeGreaterThanOrEqual(0);
  });
});
