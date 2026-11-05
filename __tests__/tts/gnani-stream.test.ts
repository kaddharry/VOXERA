import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * GnaniSpeakStream serializes requests via a `busy` flag, cleared only when
 * a "complete" or "error" message arrives (Gnani's protocol allows exactly
 * one request in flight). If that message is ever lost — dropped by the
 * network, or simply doesn't parse as JSON (the message handler's catch
 * silently swallows it) — `busy` stays true forever and every subsequent
 * sendText() just queues text that is never flushed: the agent goes
 * permanently silent for the rest of the call on an otherwise-healthy
 * connection. lib/deepgram/live.ts already has a near-identical safety net
 * (UTTERANCE_END_FALLBACK_MS) for "don't trust a single signal to
 * definitely fire" — this is the same fix applied to GnaniSpeakStream.
 */

const { MockSocket, instances } = vi.hoisted(() => {
  const instances: any[] = [];
  class MockSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = MockSocket.CONNECTING;
    sent: any[] = [];
    listeners: Record<string, Array<(...args: any[]) => void>> = {};
    url: string;
    constructor(url: string, _opts?: any) {
      this.url = url;
      instances.push(this);
    }
    on(event: string, cb: (...args: any[]) => void) {
      (this.listeners[event] ??= []).push(cb);
      return this;
    }
    once(event: string, cb: (...args: any[]) => void) {
      const wrapped = (...args: any[]) => {
        this.listeners[event] = (this.listeners[event] ?? []).filter((l) => l !== wrapped);
        cb(...args);
      };
      (this.listeners[event] ??= []).push(wrapped);
      return this;
    }
    emit(event: string, ...args: any[]) {
      for (const cb of this.listeners[event] ?? []) cb(...args);
    }
    send(data: any) {
      this.sent.push(data);
    }
    close() {
      this.readyState = MockSocket.CLOSED;
    }
  }
  return { MockSocket, instances };
});

vi.mock("ws", () => ({ default: MockSocket }));

import { GnaniSpeakStream } from "../../lib/tts/gnani-stream";

async function connectedStream(onAudio: (b: Buffer) => void = () => {}) {
  const stream = new GnaniSpeakStream({ voice: "Nalini", model: "timbre-v2.5", language: "hi-IN", sampleRate: 8000 }, onAudio);
  const connectPromise = stream.connect();
  const socket = instances[instances.length - 1];
  socket.readyState = MockSocket.OPEN;
  socket.emit("open");
  await connectPromise;
  return { stream, socket };
}

describe("GnaniSpeakStream", () => {
  beforeEach(() => {
    instances.length = 0;
    process.env.GNANI_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.GNANI_API_KEY;
    vi.useRealTimers();
  });

  it("normal path: queues a clause sent while busy and flushes it on complete", async () => {
    const { stream, socket } = await connectedStream();
    stream.sendText("first clause");
    expect(socket.sent).toHaveLength(1);

    stream.sendText("second clause");
    expect(socket.sent).toHaveLength(1); // still queued, not sent — only one in flight

    socket.emit("message", Buffer.from(JSON.stringify({ type: "complete", data: { is_final: true } })));
    expect(socket.sent).toHaveLength(2); // flushed as soon as complete arrived
  });

  it("recovers via a fallback timeout if complete/error never arrives, instead of muting the rest of the call", async () => {
    vi.useFakeTimers();
    const { stream, socket } = await connectedStream();

    stream.sendText("first clause");
    expect(socket.sent).toHaveLength(1);

    stream.sendText("second clause"); // queued — a real reply's next clause
    expect(socket.sent).toHaveLength(1);

    // Simulate the "complete" message never arriving (dropped, or malformed
    // and swallowed by the message handler's catch) — busy would otherwise
    // stay true for the rest of the call.
    await vi.runOnlyPendingTimersAsync();

    expect(socket.sent).toHaveLength(2); // the fallback fired and flushed the queued clause

    // The stream must still be usable afterwards — not permanently wedged.
    // "second clause" is now the in-flight request, so a third clause
    // queues normally rather than being dropped or erroring.
    stream.sendText("third clause");
    expect(socket.sent).toHaveLength(2);
    socket.emit("message", Buffer.from(JSON.stringify({ type: "complete", data: { is_final: true } })));
    expect(socket.sent).toHaveLength(3);
  });

  it("a malformed (non-JSON) message from the server doesn't permanently wedge the stream either", async () => {
    vi.useFakeTimers();
    const { stream, socket } = await connectedStream();

    stream.sendText("first clause");
    stream.sendText("second clause");
    expect(socket.sent).toHaveLength(1);

    socket.emit("message", Buffer.from("not json")); // hits the parse catch, same as a lost response
    await vi.runOnlyPendingTimersAsync();

    expect(socket.sent).toHaveLength(2);
  });

  it("close() clears the fallback timer so it doesn't fire after the call has already ended", async () => {
    vi.useFakeTimers();
    const { stream, socket } = await connectedStream();
    stream.sendText("first clause");
    expect(socket.sent).toHaveLength(1);

    stream.close();
    const pendingBefore = vi.getTimerCount();
    expect(pendingBefore).toBe(0);
  });
});
