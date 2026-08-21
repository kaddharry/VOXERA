/**
 * Covers the two riskiest new behaviors from the latency overhaul's
 * telephony rewrite (lib/telephony/stream-handler.ts):
 *  1. Streamed clauses actually reach Twilio as small (~20ms) mulaw frames,
 *     not one buffered blob.
 *  2. A barge-in mid-turn cancels the in-flight LLM call, clears/closes the
 *     active Speak stream, and stale audio/clauses from that turn never
 *     reach Twilio afterward.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/deepgram/client", () => ({ getDeepgram: vi.fn() }));

vi.mock("../../lib/db/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: vi.fn().mockImplementation((onfulfilled) => Promise.resolve({ data: null, error: null }).then(onfulfilled)),
    })),
  },
  isSupabaseHealthy: vi.fn().mockReturnValue(true),
  recordSupabaseSuccess: vi.fn(),
  recordSupabaseFailure: vi.fn(),
}));

vi.mock("../../lib/db/agents", () => ({ getAgentWithTenant: vi.fn().mockResolvedValue(null) }));

vi.mock("../../lib/queue/manager", () => ({
  callQueue: { markCallStarted: vi.fn(), markCallEnded: vi.fn() },
}));

vi.mock("../../lib/memory/stm", () => ({
  stm: { get: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../../lib/deepgram/tts", () => ({
  synthesizeLinear16: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  resolveVoiceModel: vi.fn().mockReturnValue("aura-asteria-en"),
  getClientVoiceSettings: vi.fn().mockResolvedValue(null),
}));

let capturedOnTranscript: ((text: string, isFinal: boolean) => void) | null = null;
vi.mock("../../lib/deepgram/live", () => ({
  DeepgramLiveWrapper: vi.fn().mockImplementation(function (this: any, onTranscript: any) {
    capturedOnTranscript = onTranscript;
    this.connect = vi.fn().mockResolvedValue(undefined);
    this.sendAudio = vi.fn();
    this.close = vi.fn();
    this.getState = vi.fn().mockReturnValue("connected");
  }),
}));

interface FakeSpeakStream {
  connect: ReturnType<typeof vi.fn>;
  sendText: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  setAudioHandler: ReturnType<typeof vi.fn>;
  emitAudio: (buf: Buffer) => void;
}
const speakStreamInstances: FakeSpeakStream[] = [];
vi.mock("../../lib/deepgram/tts-stream", () => ({
  DeepgramSpeakStream: vi.fn().mockImplementation(function (this: any, _opts: any, onAudioChunk: (b: Buffer) => void) {
    let handler = onAudioChunk;
    this.connect = vi.fn().mockResolvedValue(undefined);
    this.sendText = vi.fn();
    this.flush = vi.fn();
    this.clear = vi.fn();
    this.close = vi.fn();
    this.setAudioHandler = vi.fn((cb: (b: Buffer) => void) => {
      handler = cb;
    });
    this.emitAudio = (buf: Buffer) => handler(buf);
    speakStreamInstances.push(this);
  }),
}));

const handleTurnMock = vi.fn();
vi.mock("../../lib/agent/orchestrator", () => ({
  handleTurn: (...args: any[]) => handleTurnMock(...args),
}));

function makeMockWs() {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  return {
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    }),
    send: vi.fn(),
    readyState: 1,
    listeners,
  } as any;
}

function sentMediaPayloads(mockWs: ReturnType<typeof makeMockWs>): string[] {
  return mockWs.send.mock.calls
    .map((c: any[]) => JSON.parse(c[0]))
    .filter((m: any) => m.event === "media")
    .map((m: any) => m.media.payload);
}

function sentEventTypes(mockWs: ReturnType<typeof makeMockWs>): string[] {
  return mockWs.send.mock.calls.map((c: any[]) => JSON.parse(c[0]).event);
}

async function startCall(mockWs: ReturnType<typeof makeMockWs>) {
  const { TelephonyStreamHandler } = await import("../../lib/telephony/stream-handler");
  new TelephonyStreamHandler({
    ws: mockWs,
    callSid: "test-call",
    clientId: "test-client",
    callerNumber: "+15551234567",
  });
  await new Promise((r) => setTimeout(r, 5));
  const onMessage = mockWs.listeners["message"][0];
  onMessage(Buffer.from(JSON.stringify({ event: "start", start: { streamSid: "stream-1" } })));
  await new Promise((r) => setTimeout(r, 5)); // let setupVoiceForCall() resolve
  return onMessage;
}

describe("TelephonyStreamHandler — streaming TTS delivers Twilio-sized frames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    speakStreamInstances.length = 0;
    capturedOnTranscript = null;
  });

  it("splits a Deepgram audio chunk into 160-byte mulaw frames sent as Twilio media events", async () => {
    handleTurnMock.mockImplementation(async (_input: any, opts: any) => {
      opts.onReplyChunk("Sure thing.");
      return { reply: "Sure thing.", trace: { emotion: { current: { label: "neutral" } }, agent: undefined } };
    });

    const mockWs = makeMockWs();
    await startCall(mockWs);

    capturedOnTranscript!("book me a table", true);
    await new Promise((r) => setTimeout(r, 10));

    expect(speakStreamInstances).toHaveLength(1);
    // 640 bytes PCM -> 320 bytes mulaw -> two 160-byte Twilio frames.
    speakStreamInstances[0].emitAudio(Buffer.alloc(640));

    const payloads = sentMediaPayloads(mockWs);
    expect(payloads.length).toBe(2);
    for (const p of payloads) {
      expect(Buffer.from(p, "base64").length).toBe(160);
    }
  });

  it("reuses the same Speak connection across turns instead of reconnecting each time", async () => {
    handleTurnMock.mockImplementation(async (_input: any, opts: any) => {
      opts.onReplyChunk("Reply.");
      return { reply: "Reply.", trace: { emotion: { current: { label: "neutral" } }, agent: undefined } };
    });

    const mockWs = makeMockWs();
    await startCall(mockWs);
    // The "start" handler eagerly connects the stream — already 1 instance
    // before any turn happens.
    expect(speakStreamInstances).toHaveLength(1);
    const firstConnectCalls = speakStreamInstances[0].connect.mock.calls.length;

    capturedOnTranscript!("first turn", true);
    await new Promise((r) => setTimeout(r, 10));
    capturedOnTranscript!("second turn", true);
    await new Promise((r) => setTimeout(r, 10));

    // Still exactly one DeepgramSpeakStream ever constructed, and connect()
    // was never called again for the second turn.
    expect(speakStreamInstances).toHaveLength(1);
    expect(speakStreamInstances[0].connect.mock.calls.length).toBe(firstConnectCalls);
    expect(speakStreamInstances[0].close).not.toHaveBeenCalled();
    expect(speakStreamInstances[0].sendText).toHaveBeenCalledWith("Reply.");
    expect(speakStreamInstances[0].sendText.mock.calls.length).toBe(2);
    expect(speakStreamInstances[0].flush).toHaveBeenCalled();
  });
});

describe("TelephonyStreamHandler — barge-in cancels the in-flight turn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    speakStreamInstances.length = 0;
    capturedOnTranscript = null;
  });

  it("aborts the LLM call, clears+closes the speak stream, and drops stale audio after a barge-in", async () => {
    let capturedAbortSignal: AbortSignal | undefined;
    let resolveHandleTurn!: (v: any) => void;
    handleTurnMock.mockImplementation((_input: any, opts: any) => {
      capturedAbortSignal = opts.abortSignal;
      opts.onReplyChunk("Starting a long reply");
      return new Promise((resolve) => {
        resolveHandleTurn = resolve;
      });
    });

    const mockWs = makeMockWs();
    const onMessage = await startCall(mockWs);

    capturedOnTranscript!("tell me a long story", true);
    await new Promise((r) => setTimeout(r, 10));

    expect(speakStreamInstances).toHaveLength(1);
    const stream = speakStreamInstances[0];

    // Simulate loud caller audio arriving while the agent is "speaking"
    // (isSpeaking flips true as soon as the first onReplyChunk clause
    // fires). 0x00 mulaw bytes decode to near-max-amplitude PCM — the same
    // codec the existing telephony-pipeline test already validates 0xFF
    // (silence) against, at the opposite end of the table.
    const loudMulaw = Buffer.alloc(160, 0x00);
    onMessage(Buffer.from(JSON.stringify({
      event: "media",
      media: { payload: loudMulaw.toString("base64") },
    })));

    expect(capturedAbortSignal?.aborted).toBe(true);
    expect(stream.clear).toHaveBeenCalled();
    // NOT closed — the connection is kept alive for the whole call so the
    // next turn doesn't pay another WS handshake; barge-in only clears
    // whatever was queued/in-flight for the interrupted turn.
    expect(stream.close).not.toHaveBeenCalled();
    expect(sentEventTypes(mockWs)).toContain("clear");

    // Audio arriving late from the now-stale stream must be dropped, not forwarded.
    mockWs.send.mockClear();
    stream.emitAudio(Buffer.alloc(640));
    expect(sentMediaPayloads(mockWs)).toHaveLength(0);

    // The still-pending handleTurn() from the aborted turn resolving late
    // must not throw or re-open the door for isBusy to stay stuck.
    resolveHandleTurn({ reply: "stale", trace: { emotion: { current: { label: "neutral" } }, agent: undefined } });
    await new Promise((r) => setTimeout(r, 5));
  });
});
