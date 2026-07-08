import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock embed to avoid API calls
vi.mock("../../lib/util/embed", () => ({
  embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.01)),
  EMBED_DIM: 1536,
}));

// Mock SMS sending utility
const mockSendSMS = vi.fn();
vi.mock("../../lib/telephony/sms", () => ({
  sendSMS: (...args: any[]) => mockSendSMS(...args),
}));

// Mock Deepgram client
vi.mock("../../lib/deepgram/client", () => ({
  getDeepgram: vi.fn().mockReturnValue({
    speak: {
      v1: {
        audio: {
          generate: vi.fn().mockResolvedValue({
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
          }),
        },
      },
    },
  }),
}));

// Setup global mock settings
let mockSettings = {
  voice_provider: "elevenlabs",
  custom_voice_id: "test-elevenlabs-voice-id",
  sms_recovery_enabled: true,
  sms_recovery_template: "Hi, we noticed you had a bad experience. Use {{link}} to get in touch.",
  sms_recovery_link: "https://support.com",
};

// Define a fully complete mock chain
const mockChain = {
  select: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockImplementation(() => {
    const globalMock = (global as any).supabaseMockData;
    const settings = globalMock?.business_settings || mockSettings;
    const tenant = globalMock?.tenants || { id: "test-tenant-id" };
    
    // We determine what to return based on the mocked context
    if ((global as any).currentMockTable === "tenants") {
      return Promise.resolve({ data: tenant, error: null });
    }
    return Promise.resolve({ data: settings, error: null });
  }),
  then: vi.fn().mockImplementation((onfulfilled) => {
    return Promise.resolve({ data: null, error: null }).then(onfulfilled);
  }),
};

vi.mock("../../lib/db/supabase", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      (global as any).currentMockTable = table;
      return mockChain;
    }),
  },
  isSupabaseHealthy: vi.fn().mockReturnValue(true),
  recordSupabaseSuccess: vi.fn(),
  recordSupabaseFailure: vi.fn(),
}));

// Mock STM sessions
let mockUtterances: any[] = [];
vi.mock("../../lib/memory/stm", () => ({
  stm: {
    get: vi.fn().mockImplementation(() => Promise.resolve(mockUtterances)),
    push: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../lib/queue/manager", () => ({
  callQueue: {
    markCallStarted: vi.fn(),
    markCallEnded: vi.fn(),
  },
}));

import { cloneVoiceElevenLabs } from "../../lib/tts/voice-clone";
import { synthesizeLinear16 } from "../../lib/deepgram/tts";
import { TelephonyStreamHandler } from "../../lib/telephony/stream-handler";
import { DeepgramLiveWrapper } from "../../lib/deepgram/live";

describe("Voice Personalization & Customer Recovery (Issue #16)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUtterances = [];
    mockSettings = {
      voice_provider: "elevenlabs",
      custom_voice_id: "test-elevenlabs-voice-id",
      sms_recovery_enabled: true,
      sms_recovery_template: "Hi, we noticed you had a bad experience. Use {{link}} to get in touch.",
      sms_recovery_link: "https://support.com",
    };
    (global as any).supabaseMockData = {
      tenants: { id: "test-tenant-id" },
      business_settings: mockSettings,
    };
  });

  describe("Voice Cloning (ElevenLabs mock)", () => {
    it("returns a mock voice ID if API key is not present", async () => {
      const result = await cloneVoiceElevenLabs({
        name: "Test User Voice",
        fileBuffer: Buffer.from("fake-audio"),
        fileName: "sample.mp3",
        mimeType: "audio/mp3",
      });
      expect(result).toContain("mock-elevenlabs-");
    });
  });

  describe("Voice Settings & TTS Routing", () => {
    it("routes speech synthesis to ElevenLabs when configured", async () => {
      const result = await synthesizeLinear16("Hello", { clientId: "test-client" });
      expect(result.length).toBe(16000);
    });

    it("falls back to Deepgram if custom voice provider is not configured", async () => {
      mockSettings.voice_provider = "";
      mockSettings.custom_voice_id = "";
      (global as any).supabaseMockData.business_settings = mockSettings;
      
      const result = await synthesizeLinear16("Hello", { clientId: "test-client" });
      expect(result.length).toBe(100); // Deepgram mock returns 100 bytes buffer
    });
  });

  describe("Customer SMS Recovery Trigger", () => {
    it("sends SMS to customer if call ends with negative sentiment", async () => {
      mockUtterances = [
        { role: "agent", text: "How can I help you?", ts: Date.now() - 5000 },
        {
          role: "user",
          text: "This is unacceptable!",
          ts: Date.now(),
          emotion: { label: "anger", intensity: 0.9, confidence: 0.9, source: "text" },
        },
      ];

      const connectSpy = vi.spyOn(DeepgramLiveWrapper.prototype, "connect").mockResolvedValue(undefined);
      const closeSpy = vi.spyOn(DeepgramLiveWrapper.prototype, "close").mockImplementation(() => {});

      const mockWs = {
        on: vi.fn(),
        send: vi.fn(),
        readyState: 1,
      } as any;

      const handler = new TelephonyStreamHandler({
        ws: mockWs,
        callSid: "test-recovery-call",
        clientId: "test-client",
        callerNumber: "+155501999",
      });

      await (handler as any).onCallEnded();

      expect(mockSendSMS).toHaveBeenCalledWith({
        to: "+155501999",
        body: "Hi, we noticed you had a bad experience. Use https://support.com to get in touch.",
      });

      connectSpy.mockRestore();
      closeSpy.mockRestore();
    });

    it("does NOT send SMS if call ends with positive sentiment", async () => {
      mockUtterances = [
        { role: "agent", text: "How can I help you?", ts: Date.now() - 5000 },
        {
          role: "user",
          text: "Thank you so much!",
          ts: Date.now(),
          emotion: { label: "joy", intensity: 0.9, confidence: 0.9, source: "text" },
        },
      ];

      const connectSpy = vi.spyOn(DeepgramLiveWrapper.prototype, "connect").mockResolvedValue(undefined);
      const closeSpy = vi.spyOn(DeepgramLiveWrapper.prototype, "close").mockImplementation(() => {});

      const mockWs = {
        on: vi.fn(),
        send: vi.fn(),
        readyState: 1,
      } as any;

      const handler = new TelephonyStreamHandler({
        ws: mockWs,
        callSid: "test-no-recovery-call",
        clientId: "test-client",
        callerNumber: "+155501999",
      });

      await (handler as any).onCallEnded();

      expect(mockSendSMS).not.toHaveBeenCalled();

      connectSpy.mockRestore();
      closeSpy.mockRestore();
    });

    it("does NOT send SMS if customer recovery is disabled", async () => {
      mockSettings.sms_recovery_enabled = false;
      (global as any).supabaseMockData.business_settings = mockSettings;
      
      mockUtterances = [
        { role: "agent", text: "How can I help you?", ts: Date.now() - 5000 },
        {
          role: "user",
          text: "This is terrible!",
          ts: Date.now(),
          emotion: { label: "anger", intensity: 0.9, confidence: 0.9, source: "text" },
        },
      ];

      const connectSpy = vi.spyOn(DeepgramLiveWrapper.prototype, "connect").mockResolvedValue(undefined);
      const closeSpy = vi.spyOn(DeepgramLiveWrapper.prototype, "close").mockImplementation(() => {});

      const mockWs = {
        on: vi.fn(),
        send: vi.fn(),
        readyState: 1,
      } as any;

      const handler = new TelephonyStreamHandler({
        ws: mockWs,
        callSid: "test-disabled-recovery-call",
        clientId: "test-client",
        callerNumber: "+155501999",
      });

      await (handler as any).onCallEnded();

      expect(mockSendSMS).not.toHaveBeenCalled();

      connectSpy.mockRestore();
      closeSpy.mockRestore();
    });
  });
});
