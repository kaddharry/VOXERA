import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A scriptable stand-in for the Gnani websocket.
const sent: string[] = [];
let scripted: Array<"ok" | "error"> = [];
let emit: (msg: unknown) => void = () => {};
vi.mock("ws", () => {
  class FakeWS {
    static OPEN = 1;
    readyState = 1;
    private handlers: Record<string, (...a: any[]) => void> = {};
    on(ev: string, cb: any) { this.handlers[ev] = cb; return this; }
    once(ev: string, cb: any) { this.handlers[ev] = cb; if (ev === "open") queueMicrotask(cb); return this; }
    send(data: string) {
      sent.push(JSON.parse(data).text);
      const outcome = scripted.shift() ?? "ok";
      setTimeout(() => {
        if (outcome === "error") this.handlers.message?.(JSON.stringify({ type: "error", message: "We are facing technical difficulties." }));
        else {
          this.handlers.message?.(JSON.stringify({ type: "audio", data: { audio: Buffer.from("pcm").toString("base64") } }));
          this.handlers.message?.(JSON.stringify({ type: "complete" }));
        }
      }, 0);
    }
    close() {}
  }
  return { default: FakeWS };
});
const restFallback = vi.fn();
vi.mock("../../lib/tts/gnani", () => ({ callGnaniTTS: (...a: any[]) => restFallback(...a) }));
const deepgramFallback = vi.fn();
vi.mock("../../lib/tts/deepgram-fallback", async () => {
  const real = await vi.importActual<typeof import("../../lib/tts/deepgram-fallback")>("../../lib/tts/deepgram-fallback");
  return { ...real, synthesizeDeepgramRaw: (...a: any[]) => deepgramFallback(...a) };
});

import { GnaniSpeakStream } from "../../lib/tts/gnani-stream";

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function makeStream() {
  process.env.GNANI_API_KEY = "test";
  const audio: Buffer[] = [];
  const s = new GnaniSpeakStream({ voice: "v", model: "timbre-v3.0" as any, language: "auto", sampleRate: 16000 }, (b) => audio.push(b));
  await s.connect();
  return { s, audio };
}

describe("GnaniSpeakStream", () => {
  beforeEach(() => { sent.length = 0; scripted = []; restFallback.mockReset(); deepgramFallback.mockReset(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it("speaks EVERY clause, in order, even when they arrive faster than they synthesize", async () => {
    const { s, audio } = await makeStream();
    s.sendText("clause one.");
    s.sendText("clause two.");
    s.sendText("clause three.");
    s.sendText("clause four.");
    await tick(120);
    expect(sent).toEqual(["clause one.", "clause two.", "clause three.", "clause four."]);
    expect(audio.length).toBe(4);
  });

  it("retries a clause the server rejects instead of dropping it", async () => {
    const { s, audio } = await makeStream();
    scripted = ["error", "ok"];
    s.sendText("hello there.");
    await tick(700);
    expect(sent).toEqual(["hello there.", "hello there."]);
    expect(audio.length).toBe(1);
  });

  it("falls back to the REST endpoint after repeated failures", async () => {
    restFallback.mockResolvedValue(Buffer.from("rest-audio"));
    const { s, audio } = await makeStream();
    scripted = ["error", "error", "error"];
    s.sendText("important sentence.");
    await tick(1500);
    expect(sent.length).toBe(3);
    expect(restFallback).toHaveBeenCalledTimes(1);
    expect(audio.map((b) => b.toString())).toContain("rest-audio");
  });

  it("voices an English clause with Deepgram when Gnani is completely down", async () => {
    restFallback.mockRejectedValue(new Error("down"));
    deepgramFallback.mockResolvedValue(Buffer.from("deepgram-audio"));
    const { s, audio } = await makeStream();
    scripted = ["error", "error", "error"];
    s.sendText("I can book you tomorrow at ten.");
    await tick(1500);
    expect(deepgramFallback).toHaveBeenCalledWith("I can book you tomorrow at ten.", 16000);
    expect(audio.map((b) => b.toString())).toContain("deepgram-audio");
  });

  it("does not send Hindi to the English-only Deepgram voice", async () => {
    restFallback.mockRejectedValue(new Error("down"));
    const { s } = await makeStream();
    scripted = ["error", "error", "error"];
    s.sendText("आपको ये परेशानी हो रही है।");
    await tick(1500);
    expect(deepgramFallback).not.toHaveBeenCalled();
  });

  it("keeps going with the next clause when even the fallback fails", async () => {
    restFallback.mockRejectedValue(new Error("down"));
    const { s } = await makeStream();
    scripted = ["error", "error", "error"];
    s.sendText("first.");
    s.sendText("second.");
    await tick(1800);
    expect(sent).toContain("second.");
  });

  it("barge-in (clear) drops everything still queued", async () => {
    const { s } = await makeStream();
    s.sendText("one.");
    s.sendText("two.");
    s.sendText("three.");
    s.clear();
    await tick(80);
    expect(sent).toEqual(["one."]);
  });
});
