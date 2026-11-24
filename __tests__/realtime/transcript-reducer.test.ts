import { describe, it, expect } from "vitest";
import { reduceTranscript, type TranscriptState } from "../../lib/realtime/transcript-reducer";
import { TurnMarks, CallerSoundClock } from "../../lib/realtime/turn-latency";

const L = { listenMs: 900, thinkMs: 1200, voiceMs: 250, firstWordMs: 2350, replyMs: 3000 };
const empty = (): TranscriptState => ({ transcript: [] });
const fold = (events: Array<{ type: string; data: any; timestamp?: number }>) => events.reduce((s, e) => reduceTranscript(s, e), empty());

describe("live transcript timestamps and latency", () => {
  it("stamps every bubble with its server time and zeroes the clock at the first event", () => {
    const s = fold([
      { type: "transcript", data: { role: "user", text: "hello" }, timestamp: 1_000_000 },
      { type: "transcript", data: { role: "agent", text: "hi there" }, timestamp: 1_002_345 },
    ]);
    expect(s.startTs).toBe(1_000_000);
    expect(s.transcript.map((t) => t.ts)).toEqual([1_000_000, 1_002_345]);
  });

  it("a streamed reply keeps the time of its FIRST word, not of the final text", () => {
    const s = fold([
      { type: "transcript", data: { role: "user", text: "q" }, timestamp: 100 },
      { type: "transcript_delta", data: { role: "agent", text: "Hel" }, timestamp: 1_500 },
      { type: "transcript_delta", data: { role: "agent", text: "Hello there" }, timestamp: 1_700 },
      { type: "transcript", data: { role: "agent", text: "Hello there." }, timestamp: 2_400 },
    ]);
    expect(s.transcript).toHaveLength(2);
    expect(s.transcript[1]).toMatchObject({ text: "Hello there.", ts: 1_500 });
    expect(s.transcript[1].streaming).toBeUndefined();
  });

  it("latency attaches to the reply being spoken", () => {
    const s = fold([
      { type: "transcript", data: { role: "user", text: "q" }, timestamp: 100 },
      { type: "transcript_delta", data: { role: "agent", text: "Hel" }, timestamp: 1_500 },
      { type: "latency", data: L, timestamp: 1_800 },
      { type: "transcript", data: { role: "agent", text: "Hello." }, timestamp: 2_400 },
    ]);
    expect(s.transcript[1].latency).toEqual(L);
    expect(s.transcript[0].latency).toBeUndefined();
  });

  it("latency that arrives BEFORE its reply bubble is held and applied to the next agent bubble", () => {
    const s = fold([
      { type: "transcript", data: { role: "user", text: "q" }, timestamp: 100 },
      { type: "latency", data: L, timestamp: 900 },
      { type: "transcript", data: { role: "agent", text: "Hello." }, timestamp: 2_400 },
    ]);
    expect(s.transcript[1].latency).toEqual(L);
    expect(s.pendingLatency).toBeUndefined();
  });

  it("each reply gets ITS OWN latency (a second reply never inherits the first's)", () => {
    const L2 = { ...L, firstWordMs: 5000 };
    const s = fold([
      { type: "transcript", data: { role: "user", text: "q1" }, timestamp: 100 },
      { type: "transcript", data: { role: "agent", text: "a1" }, timestamp: 200 },
      { type: "latency", data: L, timestamp: 210 },
      { type: "transcript", data: { role: "user", text: "q2" }, timestamp: 300 },
      { type: "transcript", data: { role: "agent", text: "a2" }, timestamp: 400 },
      { type: "latency", data: L2, timestamp: 410 },
    ]);
    expect(s.transcript.filter((t) => t.role === "agent").map((t) => t.latency?.firstWordMs)).toEqual([2350, 5000]);
  });

  it("user bubbles never get a latency", () => {
    const s = fold([{ type: "latency", data: L, timestamp: 5 }, { type: "transcript", data: { role: "user", text: "q" }, timestamp: 6 }]);
    expect(s.transcript[0].latency).toBeUndefined();
  });
});

describe("TurnMarks", () => {
  it("measures listen/think/voice and the end-to-end first word, once", async () => {
    const stopped = Date.now() - 1000; // the caller last made sound a second ago
    const m = new TurnMarks(Date.now() - 100, stopped);
    m.firstClause();
    m.ttsSend();
    const first = m.firstAudio()!;
    expect(first.listenMs).toBeGreaterThanOrEqual(890);
    expect(first.thinkMs).toBeGreaterThanOrEqual(90);
    expect(first.voiceMs).toBeGreaterThanOrEqual(0);
    expect(first.firstWordMs).toBeGreaterThanOrEqual(first.listenMs);
    expect(m.firstAudio()).toBeUndefined(); // reported exactly once
  });
  it("falls back to the transcript time when no caller sound was seen", () => {
    const m = new TurnMarks(Date.now() - 50, 0);
    expect(m.snapshot().listenMs).toBe(0);
  });
  it("CallerSoundClock remembers only real sound", () => {
    const c = new CallerSoundClock();
    c.note(50);
    expect(c.at).toBe(0);
    c.note(5000);
    expect(c.at).toBeGreaterThan(0);
  });
});
