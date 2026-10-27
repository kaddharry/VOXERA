import { describe, expect, it } from "vitest";
import { extractAcousticFeatures, isolateLastUtterance } from "../../lib/audio/acoustic";

const RATE = 8000;
function tone(ms: number, amplitude = 4000, hz = 180): Buffer {
  const n = Math.round((ms / 1000) * RATE);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / RATE) * amplitude), i * 2);
  return buf;
}
const silence = (ms: number) => Buffer.alloc(Math.round((ms / 1000) * RATE) * 2);
const durationMs = (b: Buffer) => (b.length / 2 / RATE) * 1000;

describe("isolateLastUtterance", () => {
  it("drops the silence recorded before the caller started speaking", () => {
    // 6s of the line waiting while the agent spoke, then a 2s sentence.
    const turn = Buffer.concat([silence(6000), tone(2000), silence(400)]);
    const utterance = isolateLastUtterance(turn);
    expect(durationMs(utterance)).toBeGreaterThan(2000);
    expect(durationMs(utterance)).toBeLessThan(2300);
  });

  it("keeps short pauses inside the sentence but not an earlier, separate utterance", () => {
    const turn = Buffer.concat([tone(800), silence(4000), tone(1000), silence(500), tone(1000)]);
    const utterance = isolateLastUtterance(turn);
    // 1000 + 500 pause + 1000, plus edge padding — the first utterance is gone.
    expect(durationMs(utterance)).toBeGreaterThan(2500);
    expect(durationMs(utterance)).toBeLessThan(2800);
  });

  it("returns nothing for a buffer with no speech", () => {
    expect(isolateLastUtterance(silence(3000)).length).toBe(0);
  });

  it("gives a realistic speaking rate and pause time for a live-call turn", () => {
    // The measured failure: 8 words in a 2.5s sentence after 8s of silence
    // came out at ~45 wpm with ~8s of "pauses".
    const turn = Buffer.concat([silence(8000), tone(1200), silence(350), tone(950)]);
    const raw = extractAcousticFeatures(turn, 8);
    const fixed = extractAcousticFeatures(isolateLastUtterance(turn), 8);
    expect(raw.speakingRateWPM).toBeLessThan(60);
    expect(fixed.speakingRateWPM).toBeGreaterThan(180);
    expect(fixed.pauseDurationMs).toBeLessThan(500);
  });
});
