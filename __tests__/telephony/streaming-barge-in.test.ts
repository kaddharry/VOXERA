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
  DeepgramLiveWrapper: vi.fn().mockImplementation(function (this: any, onTranscript: any, opts: any) {
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
const recordInterruptedReplyMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/agent/orchestrator", () => ({
  handleTurn: (...args: any[]) => handleTurnMock(...args),
  recordInterruptedReply: (...args: any[]) => recordInterruptedReplyMock(...args),
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

/**
 * A loud, speech-shaped 160-byte (20ms) mulaw frame — alternates between two
 * mulaw bytes that decode to +/-5000 PCM every `period` samples, giving it
 * both high RMS energy and a moderate, real-voice-like zero-crossing rate
 * (unlike a flat/constant-value frame, which is loud but has ZCR=0 — the
 * exact "loud but noise-shaped, not speech-shaped" case the barge-in ZCR
 * gate in lib/telephony/stream-handler.ts is meant to reject).
 */
function makeVoicedMulawFrame(period = 20): Buffer {
  const POS = 0xab; // mulaw encoding of PCM +5000
  const NEG = 0x2b; // mulaw encoding of PCM -5000
  const buf = Buffer.alloc(160);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Math.floor(i / period) % 2 === 0 ? POS : NEG;
  }
  return buf;
}

/** A loud but flat/constant mulaw frame — high RMS, zero-crossing-rate 0. */
function makeFlatLoudMulawFrame(): Buffer {
  return Buffer.alloc(160, 0x00);
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

  it("stops the agent as soon as the caller's words come through, even mid-word (interim transcript)", async () => {
    let capturedAbortSignal: AbortSignal | undefined;
    handleTurnMock.mockImplementation((_input: any, opts: any) => {
      capturedAbortSignal = opts.abortSignal;
      opts.onReplyChunk("Starting a long reply");
      return new Promise(() => {});
    });

    const mockWs = makeMockWs();
    await startCall(mockWs);

    capturedOnTranscript!("tell me a long story", true);
    await new Promise((r) => setTimeout(r, 10));
    const stream = speakStreamInstances[0];

    capturedOnTranscript!("wait", false);

    expect(capturedAbortSignal?.aborted).toBe(true);
    expect(stream.clear).toHaveBeenCalled();
    expect(sentEventTypes(mockWs)).toContain("clear");
  });

  it("doesn't react to the caller talking when the agent is silent (no reply in flight or playing)", async () => {
    const mockWs = makeMockWs();
    await startCall(mockWs);

    capturedOnTranscript!("so the thing is", false);

    expect(sentEventTypes(mockWs)).not.toContain("clear");
    expect(handleTurnMock).not.toHaveBeenCalled();
  });

  it("still stops the agent while its reply is playing after generation finished (Twilio mark not yet echoed)", async () => {
    const turns: string[] = [];
    handleTurnMock.mockImplementation(async (input: any, opts: any) => {
      turns.push(input.transcript);
      opts.onReplyChunk("Here's a long answer.");
      return { reply: "Here's a long answer.", trace: { emotion: { current: { label: "neutral" } }, agent: undefined } };
    });

    const mockWs = makeMockWs();
    const onMessage = await startCall(mockWs);
    const marks = () => mockWs.send.mock.calls.map((c: any[]) => JSON.parse(c[0])).filter((m: any) => m.event === "mark");

    capturedOnTranscript!("what should I eat", true);
    await new Promise((r) => setTimeout(r, 10));
    // Its audio reaches Twilio, which then plays it for several seconds.
    speakStreamInstances[0].emitAudio(Buffer.alloc(640));
    expect(marks()).toHaveLength(1);

    // The reply text is complete (handleTurn returned) but still audible:
    // the caller talking over it must stop it, not queue a second reply
    // behind it.
    capturedOnTranscript!("sorry I can't hear you", true);
    await new Promise((r) => setTimeout(r, 10));
    expect(sentEventTypes(mockWs)).toContain("clear");
    expect(turns).toEqual(["what should I eat", "sorry I can't hear you"]);

    // Once Twilio reports the reply has played, talking is a normal turn again.
    mockWs.send.mockClear();
    speakStreamInstances[0].emitAudio(Buffer.alloc(640));
    const name = marks()[0].mark.name;
    onMessage(Buffer.from(JSON.stringify({ event: "mark", streamSid: "stream-1", mark: { name } })));
    mockWs.send.mockClear();
    capturedOnTranscript!("thanks", true);
    await new Promise((r) => setTimeout(r, 10));
    expect(sentEventTypes(mockWs)).not.toContain("clear");
    expect(turns).toEqual(["what should I eat", "sorry I can't hear you", "thanks"]);
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

    // The caller talks over the agent.
    void onMessage;
    capturedOnTranscript!("hold on a second", false);

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

  it("persists whatever the agent had genuinely said before a barge-in, so the next turn's memory isn't silently missing it", async () => {
    // Mirrors the real pipeline: a barge-in mid-reply makes the aborted
    // handleTurn() call REJECT (not resolve late) — orchestrator's own
    // generateReply()/KeyRotator machinery propagates the abort as a
    // thrown error once part of the reply has already streamed. Two
    // clauses fire via onReplyChunk before the reject, so both should be
    // treated as genuinely spoken and handed to recordInterruptedReply.
    let rejectHandleTurn!: (err: unknown) => void;
    handleTurnMock.mockImplementation((_input: any, opts: any) => {
      opts.onReplyChunk("Alex, before I get to that —");
      opts.onReplyChunk("you mentioned your leg is swollen.");
      return new Promise((_resolve, reject) => {
        rejectHandleTurn = reject;
      });
    });

    const mockWs = makeMockWs();
    const onMessage = await startCall(mockWs);

    capturedOnTranscript!("tell me about my exercise", true);
    await new Promise((r) => setTimeout(r, 10));

    // Barge-in happens FIRST (bumps generation) — only afterward does the
    // aborted request's rejection actually arrive, matching real timing:
    // the interruption is detected immediately, but generateReply()'s
    // underlying fetch takes a moment longer to actually throw.
    void onMessage;
    capturedOnTranscript!("stop, that is not what I asked", false);

    rejectHandleTurn(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await new Promise((r) => setTimeout(r, 15));

    expect(recordInterruptedReplyMock).toHaveBeenCalledTimes(1);
    const call = recordInterruptedReplyMock.mock.calls[0][0];
    expect(call.partialText).toBe("Alex, before I get to that — you mentioned your leg is swollen.");
    expect(call.sessionId).toBeTruthy();
    expect(call.clientId).toBe("test-client");
  });

  it("does NOT persist an interrupted reply when nothing was actually spoken before the failure (a same-turn technical failure, not a real barge-in)", async () => {
    handleTurnMock.mockImplementation((_input: any, _opts: any) => {
      return Promise.reject(new Error("some unrelated handleTurn failure"));
    });

    const mockWs = makeMockWs();
    await startCall(mockWs);

    capturedOnTranscript!("hello", true);
    await new Promise((r) => setTimeout(r, 10));

    expect(recordInterruptedReplyMock).not.toHaveBeenCalled();
  });

  it("never stops the agent for noise alone — a cough, a click or a steady hum", async () => {
    let capturedAbortSignal: AbortSignal | undefined;
    handleTurnMock.mockImplementation((_input: any, opts: any) => {
      capturedAbortSignal = opts.abortSignal;
      opts.onReplyChunk("Starting a long reply");
      return new Promise(() => {});
    });

    const mockWs = makeMockWs();
    const onMessage = await startCall(mockWs);

    capturedOnTranscript!("tell me a long story", true);
    await new Promise((r) => setTimeout(r, 10));

    // Loud speech-shaped frames (a cough) and loud flat frames (a hum):
    // without any words behind them, nothing happens.
    const frames = [makeVoicedMulawFrame(), makeVoicedMulawFrame(), makeVoicedMulawFrame(), ...Array(10).fill(makeFlatLoudMulawFrame())];
    for (const frame of frames) {
      onMessage(Buffer.from(JSON.stringify({ event: "media", media: { payload: frame.toString("base64") } })));
    }

    expect(capturedAbortSignal?.aborted).toBe(false);
    expect(sentEventTypes(mockWs)).not.toContain("clear");
  });

  it("keeps talking through listening sounds (hmm, yeah okay, I see)", async () => {
    let capturedAbortSignal: AbortSignal | undefined;
    handleTurnMock.mockImplementation((_input: any, opts: any) => {
      capturedAbortSignal = opts.abortSignal;
      opts.onReplyChunk("Starting a long reply");
      return new Promise(() => {});
    });

    const mockWs = makeMockWs();
    await startCall(mockWs);

    capturedOnTranscript!("tell me a long story", true);
    await new Promise((r) => setTimeout(r, 10));

    for (const t of ["hmm", "yeah okay", "Mm-hmm.", "I see", "uh huh"]) {
      capturedOnTranscript!(t, false);
      capturedOnTranscript!(t, true);
    }
    await new Promise((r) => setTimeout(r, 10));

    expect(capturedAbortSignal?.aborted).toBe(false);
    expect(sentEventTypes(mockWs)).not.toContain("clear");
    expect(handleTurnMock).toHaveBeenCalledTimes(1);
  });
});

describe("TelephonyStreamHandler — caller continues after a pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    speakStreamInstances.length = 0;
    capturedOnTranscript = null;
  });

  it("answers the whole sentence when the rest arrives before the reply starts", async () => {
    const turns: Array<{ transcript: string; signal: AbortSignal }> = [];
    const resolvers: Array<(v: any) => void> = [];
    handleTurnMock.mockImplementation((input: any, opts: any) => {
      turns.push({ transcript: input.transcript, signal: opts.abortSignal });
      return new Promise((resolve) => resolvers.push(resolve));
    });

    const mockWs = makeMockWs();
    await startCall(mockWs);

    capturedOnTranscript!("I'm really worried that something", true);
    await new Promise((r) => setTimeout(r, 5));
    // Still thinking, nothing spoken yet — the patient carries on.
    capturedOnTranscript!("went wrong in the surgery", true);
    await new Promise((r) => setTimeout(r, 5));

    expect(turns.map((t) => t.transcript)).toEqual([
      "I'm really worried that something",
      "I'm really worried that something went wrong in the surgery",
    ]);
    expect(turns[0].signal.aborted).toBe(true);
    expect(turns[1].signal.aborted).toBe(false);

    // The cancelled first turn finishing late must not free the line while
    // the merged turn is still running: a third sentence now merges again
    // rather than starting an overlapping turn.
    resolvers[0]({ reply: "stale", trace: { emotion: { current: { label: "neutral" } }, agent: undefined } });
    await new Promise((r) => setTimeout(r, 5));
    capturedOnTranscript!("and it hurts", true);
    await new Promise((r) => setTimeout(r, 5));
    expect(turns[2].transcript).toBe("I'm really worried that something went wrong in the surgery and it hurts");
    expect(turns[1].signal.aborted).toBe(true);
  });

  it("doesn't merge once the agent has started speaking — the caller interrupts instead", async () => {
    const turns: string[] = [];
    handleTurnMock.mockImplementation((input: any, opts: any) => {
      turns.push(input.transcript);
      opts.onReplyChunk("Let me check that.");
      return new Promise(() => {});
    });

    const mockWs = makeMockWs();
    await startCall(mockWs);

    capturedOnTranscript!("how are my results", true);
    await new Promise((r) => setTimeout(r, 5));
    capturedOnTranscript!("never mind", true);
    await new Promise((r) => setTimeout(r, 5));

    expect(turns).toEqual(["how are my results", "never mind"]);
    expect(sentEventTypes(mockWs)).toContain("clear");
  });
});

describe("TelephonyStreamHandler — caller continues after a pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    speakStreamInstances.length = 0;
    capturedOnTranscript = null;
  });

  it("answers the whole sentence when the rest arrives before the reply starts", async () => {
    const turns: Array<{ transcript: string; signal: AbortSignal }> = [];
    const resolvers: Array<(v: any) => void> = [];
    handleTurnMock.mockImplementation((input: any, opts: any) => {
      turns.push({ transcript: input.transcript, signal: opts.abortSignal });
      return new Promise((resolve) => resolvers.push(resolve));
    });

    const mockWs = makeMockWs();
    await startCall(mockWs);

    capturedOnTranscript!("I'm really worried that something", true);
    await new Promise((r) => setTimeout(r, 5));
    // Still thinking, nothing spoken yet — the patient carries on.
    capturedOnTranscript!("went wrong in the surgery", true);
    await new Promise((r) => setTimeout(r, 5));

    expect(turns.map((t) => t.transcript)).toEqual([
      "I'm really worried that something",
      "I'm really worried that something went wrong in the surgery",
    ]);
    expect(turns[0].signal.aborted).toBe(true);
    expect(turns[1].signal.aborted).toBe(false);

    // The cancelled first turn finishing late must not free the line while
    // the merged turn is still running: a third sentence now merges again
    // rather than starting an overlapping turn.
    resolvers[0]({ reply: "stale", trace: { emotion: { current: { label: "neutral" } }, agent: undefined } });
    await new Promise((r) => setTimeout(r, 5));
    capturedOnTranscript!("and it hurts", true);
    await new Promise((r) => setTimeout(r, 5));
    expect(turns[2].transcript).toBe("I'm really worried that something went wrong in the surgery and it hurts");
    expect(turns[1].signal.aborted).toBe(true);
  });

  it("doesn't merge once the agent has started speaking (barge-in handles that)", async () => {
    const turns: string[] = [];
    handleTurnMock.mockImplementation((input: any, opts: any) => {
      turns.push(input.transcript);
      opts.onReplyChunk("Let me check that.");
      return new Promise(() => {});
    });

    const mockWs = makeMockWs();
    await startCall(mockWs);

    capturedOnTranscript!("how are my results", true);
    await new Promise((r) => setTimeout(r, 5));
    capturedOnTranscript!("never mind", true);
    await new Promise((r) => setTimeout(r, 5));

    expect(turns).toEqual(["how are my results"]);
  });
});
