import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PolicyDirectives } from "../../lib/types";

// ─── Mocks (module-boundary, per repo convention) ──────────────────────────

const generateMock = vi.fn().mockResolvedValue({
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
});
vi.mock("../../lib/deepgram/client", () => ({
  getDeepgram: vi.fn().mockReturnValue({
    speak: { v1: { audio: { generate: (...args: any[]) => generateMock(...args) } } },
  }),
}));

const synthesizeElevenLabsMock = vi.fn().mockResolvedValue(Buffer.alloc(16000));
vi.mock("../../lib/tts/voice-clone", () => ({
  synthesizeElevenLabs: (...args: any[]) => synthesizeElevenLabsMock(...args),
}));

let mockProvider = "";
const mockChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockImplementation(() => {
    if ((global as any).currentMockTable === "tenants") {
      return Promise.resolve({ data: { id: "test-tenant-id" }, error: null });
    }
    return Promise.resolve({
      data: { voice_provider: mockProvider, custom_voice_id: mockProvider ? "test-voice-id" : "" },
      error: null,
    });
  }),
};
vi.mock("../../lib/db/supabase", () => ({
  supabase: { from: vi.fn((table: string) => { (global as any).currentMockTable = table; return mockChain; }) },
  isSupabaseHealthy: vi.fn().mockReturnValue(true),
}));

import { synthesizeLinear16, __clearVoiceSettingsCacheForTesting } from "../../lib/deepgram/tts";

const basePolicy: PolicyDirectives = {
  acknowledgeFirst: false,
  pace: "normal",
  allowUpsell: true,
  escalate: "none",
  notes: [],
};

describe("Adaptive voice tone wiring (BUG-V1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearVoiceSettingsCacheForTesting();
    mockProvider = "";
  });

  it("never sends a speed or pitch field to Deepgram — regression guard for BUG-V1", async () => {
    await synthesizeLinear16("Hello there", { clientId: "test-client", emotion: "anger" });
    expect(generateMock).toHaveBeenCalledTimes(1);
    const requestArg = generateMock.mock.calls[0][0];
    expect(requestArg).not.toHaveProperty("speed");
    expect(requestArg).not.toHaveProperty("pitch");
    expect(requestArg).not.toHaveProperty("pitchHint");
    // Deepgram's SpeakV1Request only accepts these — confirms we stayed within it.
    expect(Object.keys(requestArg).sort()).toEqual(["container", "encoding", "model", "sample_rate", "text"]);
  });

  it("passes the tone-derived voice_settings through to ElevenLabs for a configured tenant", async () => {
    mockProvider = "elevenlabs";
    await synthesizeLinear16("I'm sorry about that.", {
      clientId: "test-client",
      emotion: "anger",
      policy: basePolicy,
    });
    expect(synthesizeElevenLabsMock).toHaveBeenCalledTimes(1);
    const [, voiceId, voiceSettings] = synthesizeElevenLabsMock.mock.calls[0];
    expect(voiceId).toBe("test-voice-id");
    // anger -> appealing tone profile
    expect(voiceSettings).toEqual({ stability: 0.65, style: 0.35, speed: 0.85 });
  });

  it("a task-critical caller utterance overrides the emotion tone even for ElevenLabs tenants", async () => {
    mockProvider = "elevenlabs";
    await synthesizeLinear16("Sure, I can help with that.", {
      clientId: "test-client",
      emotion: "joy",
      policy: basePolicy,
      callerText: "I want to cancel and get a refund on my last payment",
    });
    const [, , voiceSettings] = synthesizeElevenLabsMock.mock.calls[0];
    // serious tone profile, not joy's "pleasing" profile
    expect(voiceSettings).toEqual({ stability: 0.85, style: 0.05, speed: 0.95 });
  });

  it("escalation policy pushes a neutral-emotion Deepgram-only reply into long pause pacing", async () => {
    const escalatedPolicy: PolicyDirectives = { ...basePolicy, escalate: "human" };
    await synthesizeLinear16("I hear you. Let me get someone to help.", {
      clientId: "test-client",
      emotion: "neutral",
      policy: escalatedPolicy,
    });
    const requestArg = generateMock.mock.calls[0][0];
    expect(requestArg.text).toContain("...");
  });
});
