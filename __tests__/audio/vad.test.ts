import { describe, it, expect } from "vitest";
import { CallerVad, VAD_FRAME_SAMPLES } from "../../lib/audio/vad";

/** A 20ms PCM16 frame of a square-ish wave: loud, with a voice-like zero-crossing rate. */
function voiced(amp: number, period = 20): Buffer {
  const b = Buffer.alloc(VAD_FRAME_SAMPLES * 2);
  for (let i = 0; i < VAD_FRAME_SAMPLES; i++) b.writeInt16LE(Math.floor(i / period) % 2 === 0 ? amp : -amp, i * 2);
  return b;
}
const silence = () => Buffer.alloc(VAD_FRAME_SAMPLES * 2);
const feed = (vad: CallerVad, frame: Buffer, n: number) => { for (let i = 0; i < n; i++) vad.push(frame); };

describe("CallerVad", () => {
  it("ignores silence and steady low-level noise", () => {
    const vad = new CallerVad();
    feed(vad, silence(), 50);
    feed(vad, voiced(150), 50); // quiet hiss
    expect(vad.speechRunMs).toBe(0);
    expect(vad.turnSpeechMs).toBe(0);
  });

  it("measures a sustained run of loud speech and ends it after the hangover", () => {
    const vad = new CallerVad();
    feed(vad, voiced(4000), 20);
    expect(vad.speechRunMs).toBe(400);
    feed(vad, silence(), 3); // within the 100ms hangover — still one run
    expect(vad.speechRunMs).toBeGreaterThan(0);
    feed(vad, silence(), 10);
    expect(vad.speechRunMs).toBe(0);
    expect(vad.turnSpeechMs).toBe(400);
  });

  it("rejects flat (zero-crossing-free) loud signals such as clicks and DC thumps", () => {
    const vad = new CallerVad();
    const flat = Buffer.alloc(VAD_FRAME_SAMPLES * 2);
    for (let i = 0; i < VAD_FRAME_SAMPLES; i++) flat.writeInt16LE(8000, i * 2);
    feed(vad, flat, 30);
    expect(vad.speechRunMs).toBe(0);
  });

  it("learns the caller's level, then stops counting a much quieter background voice", () => {
    const vad = new CallerVad();
    feed(vad, voiced(6000), 40); // the caller
    expect(vad.isCalibrated()).toBe(true);
    feed(vad, silence(), 10);
    vad.resetTurn();
    feed(vad, voiced(900), 40); // far-away second voice: audible, but < 30% of the caller
    expect(vad.turnSpeechMs).toBe(0);
    feed(vad, voiced(6000), 10); // the caller again
    expect(vad.turnSpeechMs).toBe(200);
  });

  it("reports recent speech inside a window", () => {
    const vad = new CallerVad();
    feed(vad, silence(), 30);
    feed(vad, voiced(4000), 10);
    expect(vad.recentSpeechMs(1000)).toBe(200);
    expect(vad.recentSpeechMs(100)).toBe(100);
  });

  it("buffers partial frames across push() calls", () => {
    const vad = new CallerVad();
    const f = voiced(4000);
    for (let i = 0; i < 10; i++) {
      vad.push(f.subarray(0, 100));
      vad.push(f.subarray(100));
    }
    expect(vad.turnSpeechMs).toBe(200);
  });
});
