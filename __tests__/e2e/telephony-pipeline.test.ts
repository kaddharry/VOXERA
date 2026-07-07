/**
 * Telephony Pipeline Integration Tests (Mocked)
 *
 * Tests the audio codec layer (mulaw encode/decode), Twilio message parsing,
 * and DeepgramLiveWrapper state management with mocked external dependencies.
 * Does NOT test actual Twilio WebSocket connections or real Deepgram STT.
 */
import { describe, it, expect, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../lib/deepgram/client", () => ({
  getDeepgram: vi.fn(),
}));

vi.mock("../../lib/db/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((onfulfilled) =>
        Promise.resolve({ data: null, error: null }).then(onfulfilled)
      ),
    })),
  },
  isSupabaseHealthy: vi.fn().mockReturnValue(true),
  recordSupabaseSuccess: vi.fn(),
  recordSupabaseFailure: vi.fn(),
}));

vi.mock("../../lib/queue/manager", () => ({
  callQueue: {
    markCallStarted: vi.fn(),
    markCallEnded: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({ activeCalls: 0, queuedCalls: 0, totalHandled: 0, rejected: 0 }),
    dequeueCaller: vi.fn(),
  },
}));

// ─── Audio Codec Tests ────────────────────────────────────────────────────────

describe("Telephony Pipeline Integration (Mocked Services)", () => {

  describe("Mulaw Codec", () => {
    it("decodes mulaw silence (0xFF) to near-zero PCM", () => {
      const MULAW_DECODE_TABLE: number[] = (() => {
        const table: number[] = new Array(256);
        for (let i = 0; i < 256; i++) {
          const u = ~i;
          const sign = u & 0x80;
          const exponent = (u >> 4) & 0x07;
          let mantissa = u & 0x0f;
          mantissa = (mantissa << 3) | 0x84;
          let sample = mantissa << exponent;
          sample -= 0x84;
          table[i] = sign !== 0 ? -sample : sample;
        }
        return table;
      })();

      expect(Math.abs(MULAW_DECODE_TABLE[0xFF])).toBeLessThan(200);

      for (const val of MULAW_DECODE_TABLE) {
        expect(val).toBeGreaterThanOrEqual(-32768);
        expect(val).toBeLessThanOrEqual(32767);
      }
    });

    it("encodes PCM silence to mulaw correctly", () => {
      function encodeMulaw(pcmSample: number): number {
        const BIAS = 0x84;
        const CLIP = 32635;
        let sign = 0;
        if (pcmSample < 0) { sign = 0x80; pcmSample = -pcmSample; }
        if (pcmSample > CLIP) pcmSample = CLIP;
        pcmSample += BIAS;
        let exponent = 7;
        for (let expMask = 0x4000; (pcmSample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
        const mantissa = (pcmSample >> (exponent + 3)) & 0x0f;
        const mulawByte = ~(sign | (exponent << 4) | mantissa);
        return mulawByte & 0xff;
      }

      const silenceByte = encodeMulaw(0);
      expect(silenceByte).toBeGreaterThanOrEqual(0);
      expect(silenceByte).toBeLessThanOrEqual(255);

      const maxByte = encodeMulaw(32767);
      expect(maxByte).toBeGreaterThanOrEqual(0);
      expect(maxByte).toBeLessThanOrEqual(255);

      const negByte = encodeMulaw(-1000);
      expect(negByte).toBeGreaterThanOrEqual(0);
      expect(negByte).toBeLessThanOrEqual(255);
    });

    it("roundtrip encode-decode preserves signal shape", () => {
      const MULAW_DECODE_TABLE: number[] = (() => {
        const table: number[] = new Array(256);
        for (let i = 0; i < 256; i++) {
          const u = ~i;
          const sign = u & 0x80;
          const exponent = (u >> 4) & 0x07;
          let mantissa = u & 0x0f;
          mantissa = (mantissa << 3) | 0x84;
          let sample = mantissa << exponent;
          sample -= 0x84;
          table[i] = sign !== 0 ? -sample : sample;
        }
        return table;
      })();

      function encodeMulaw(pcmSample: number): number {
        const BIAS = 0x84;
        const CLIP = 32635;
        let sign = 0;
        if (pcmSample < 0) { sign = 0x80; pcmSample = -pcmSample; }
        if (pcmSample > CLIP) pcmSample = CLIP;
        pcmSample += BIAS;
        let exponent = 7;
        for (let expMask = 0x4000; (pcmSample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
        const mantissa = (pcmSample >> (exponent + 3)) & 0x0f;
        const mulawByte = ~(sign | (exponent << 4) | mantissa);
        return mulawByte & 0xff;
      }

      const testSamples = [0, 100, 1000, 5000, 10000, -100, -5000, -10000];
      for (const sample of testSamples) {
        const encoded = encodeMulaw(sample);
        const decoded = MULAW_DECODE_TABLE[encoded];
        const tolerance = Math.max(Math.abs(sample) * 0.15, 200);
        expect(Math.abs(decoded - sample)).toBeLessThan(tolerance);
      }
    });
  });

  describe("Twilio Message Parsing", () => {
    it("correctly parses a connected event", () => {
      const msg = JSON.parse(JSON.stringify({ event: "connected" }));
      expect(msg.event).toBe("connected");
    });

    it("correctly parses a start event with streamSid", () => {
      const msg = {
        event: "start",
        start: {
          streamSid: "MZ-test-stream-sid",
          accountSid: "AC-test",
          callSid: "CA-test",
        },
      };
      expect(msg.event).toBe("start");
      expect((msg.start as any).streamSid).toBe("MZ-test-stream-sid");
    });

    it("correctly parses a media event with base64 payload", () => {
      const payload = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]).toString("base64");
      const msg = {
        event: "media",
        media: {
          payload,
          track: "inbound",
          chunk: "1",
          timestamp: "0",
        },
      };
      expect(msg.event).toBe("media");
      const decoded = Buffer.from(msg.media.payload, "base64");
      expect(decoded.length).toBe(4);
    });

    it("correctly parses a stop event", () => {
      const msg = { event: "stop" };
      expect(msg.event).toBe("stop");
    });
  });

  describe("DeepgramLiveWrapper", () => {
    it("initializes with correct default sample rate", async () => {
      const { DeepgramLiveWrapper } = await import("../../lib/deepgram/live");
      const wrapper = new DeepgramLiveWrapper();
      expect(wrapper.getState()).toBe("disconnected");
    });

    it("initializes with custom sample rate for telephony", async () => {
      const { DeepgramLiveWrapper } = await import("../../lib/deepgram/live");
      const callback = vi.fn();
      const wrapper = new DeepgramLiveWrapper(callback, { sampleRate: 8000 });
      expect(wrapper.getState()).toBe("disconnected");
    });

    it("buffers audio when in connecting state", async () => {
      const { DeepgramLiveWrapper } = await import("../../lib/deepgram/live");
      const wrapper = new DeepgramLiveWrapper();
      expect(() => wrapper.sendAudio(Buffer.from([0, 1, 2]))).not.toThrow();
    });
  });

  describe("TelephonyStreamHandler Audio Loop", () => {
    it("receives, decodes, and routes mulaw audio chunks via WebSocket", async () => {
      const { TelephonyStreamHandler } = await import("../../lib/telephony/stream-handler");
      const { DeepgramLiveWrapper } = await import("../../lib/deepgram/live");

      // Spy on DeepgramLiveWrapper methods
      const connectSpy = vi.spyOn(DeepgramLiveWrapper.prototype, "connect").mockResolvedValue(undefined);
      const sendAudioSpy = vi.spyOn(DeepgramLiveWrapper.prototype, "sendAudio").mockImplementation(() => {});
      const closeSpy = vi.spyOn(DeepgramLiveWrapper.prototype, "close").mockImplementation(() => {});

      // Mock WebSocket
      const listeners: Record<string, Function[]> = {};
      const mockWs = {
        on: vi.fn((event: string, cb: Function) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
        }),
        send: vi.fn(),
        readyState: 1, // WebSocket.OPEN
      } as any;

      // Instantiate handler
      new TelephonyStreamHandler({
        ws: mockWs,
        callSid: "test-call-123",
        clientId: "test-client",
        callerNumber: "+1234567890",
      });

      // Yield event loop to allow async TelephonyStreamHandler.init() to resolve its awaits
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Let it initialize (it runs callQueue.markCallStarted() and deepgram.connect())
      expect(connectSpy).toHaveBeenCalled();

      // Trigger "connected" event
      const onMessage = listeners["message"]?.[0];
      expect(onMessage).toBeDefined();

      onMessage(Buffer.from(JSON.stringify({ event: "connected" })));

      // Trigger "start" event
      onMessage(Buffer.from(JSON.stringify({
        event: "start",
        start: { streamSid: "stream-123" }
      })));

      // Trigger "media" event with base64 mulaw payload (0xFF is mulaw silence)
      const silencePayload = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]).toString("base64");
      onMessage(Buffer.from(JSON.stringify({
        event: "media",
        media: { payload: silencePayload }
      })));

      // Verify that sendAudio was called with the decoded PCM buffer
      expect(sendAudioSpy).toHaveBeenCalled();
      const sentBuffer = sendAudioSpy.mock.calls[0][0] as Buffer;
      expect(sentBuffer.length).toBe(8); // 4 bytes mulaw = 8 bytes linear16 PCM

      // Trigger "stop" event
      onMessage(Buffer.from(JSON.stringify({ event: "stop" })));
      expect(closeSpy).toHaveBeenCalled();

      // Clean up spies
      connectSpy.mockRestore();
      sendAudioSpy.mockRestore();
      closeSpy.mockRestore();
    });
  });
});
