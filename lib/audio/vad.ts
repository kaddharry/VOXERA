import { CONFIG } from "../config";

/**
 * Local voice-activity detector for the caller's inbound phone audio
 * (16-bit PCM, 8 kHz). Runs on every 20 ms Twilio frame with no network hop,
 * so it can answer "is the caller really talking right now?" long before a
 * transcript exists.
 *
 * What it is built to reject:
 *  - steady background noise (fan, road, line hiss): the noise floor is
 *    tracked continuously and speech must clear it by a multiplier;
 *  - a quieter second voice / TV in the room: once the caller's own voice
 *    level has been learned, a frame must reach a fraction of it to count;
 *  - clicks, thumps and hum: speech needs a plausible zero-crossing rate;
 *  - a cough or "mm-hm": consumers ask for SUSTAINED speech (speechRunMs).
 *
 * Time is counted in frames, not wall-clock, so it is deterministic in tests
 * and unaffected by event-loop jitter.
 */

export const VAD_FRAME_SAMPLES = 160; // 20 ms @ 8 kHz
export const VAD_FRAME_MS = 20;
/** Speech may dip for this many frames (100 ms) without ending a run. */
const HANGOVER_FRAMES = 5;
/** Ring buffer length for recentSpeechMs() — 2 s of history. */
const HISTORY_FRAMES = 100;

const MIN_ZCR = 0.015;
const MAX_ZCR = 0.45;

export interface VadOptions {
  noiseFloorMultiplier?: number;
  minSpeechRms?: number;
  nearFieldRatio?: number;
  calibrationFrames?: number;
}

export class CallerVad {
  private readonly noiseMult: number;
  private readonly minRms: number;
  private readonly nearRatio: number;
  private readonly calibFrames: number;

  private leftover = Buffer.alloc(0);
  private noiseFloor = 120;
  private speakerLevel = 0;
  private speechFrameCount = 0;
  private run = 0; // consecutive speech frames (hangover-tolerant)
  private quiet = 0; // consecutive non-speech frames inside the hangover
  private history = new Uint8Array(HISTORY_FRAMES);
  private head = 0;
  private framesSeen = 0;
  private turnSpeechFrames = 0;

  constructor(opts: VadOptions = {}) {
    this.noiseMult = opts.noiseFloorMultiplier ?? CONFIG.vad.noiseFloorMultiplier;
    this.minRms = opts.minSpeechRms ?? CONFIG.vad.minSpeechRms;
    this.nearRatio = opts.nearFieldRatio ?? CONFIG.vad.nearFieldRatio;
    this.calibFrames = opts.calibrationFrames ?? CONFIG.vad.calibrationFrames;
  }

  /** Feed any amount of PCM16-LE audio; it is split into 20 ms frames internally. */
  push(pcm: Buffer): void {
    const data = this.leftover.length > 0 ? Buffer.concat([this.leftover, pcm]) : pcm;
    const frameBytes = VAD_FRAME_SAMPLES * 2;
    let offset = 0;
    while (offset + frameBytes <= data.length) {
      this.processFrame(data, offset);
      offset += frameBytes;
    }
    this.leftover = offset < data.length ? Buffer.from(data.subarray(offset)) : Buffer.alloc(0);
  }

  private processFrame(buf: Buffer, offset: number): void {
    let sumSq = 0;
    let crossings = 0;
    let prev = buf.readInt16LE(offset);
    sumSq += prev * prev;
    for (let i = 1; i < VAD_FRAME_SAMPLES; i++) {
      const s = buf.readInt16LE(offset + i * 2);
      sumSq += s * s;
      if ((s >= 0) !== (prev >= 0)) crossings++;
      prev = s;
    }
    const rms = Math.sqrt(sumSq / VAD_FRAME_SAMPLES);
    const zcr = crossings / VAD_FRAME_SAMPLES;

    const floorGate = Math.max(this.minRms, this.noiseFloor * this.noiseMult);
    const nearGate = this.isCalibrated() ? Math.max(floorGate, this.speakerLevel * this.nearRatio) : floorGate;
    const isSpeech = rms >= nearGate && zcr >= MIN_ZCR && zcr <= MAX_ZCR;

    if (isSpeech) {
      // Dips inside the hangover still belong to a run already under way.
      this.run += (this.run > 0 ? this.quiet : 0) + 1;
      this.quiet = 0;
      this.speechFrameCount++;
      this.turnSpeechFrames++;
      // Learn the caller's own level from clearly-voiced frames only.
      this.speakerLevel = this.speakerLevel === 0 ? rms : this.speakerLevel * 0.95 + rms * 0.05;
    } else {
      this.quiet++;
      if (this.quiet > HANGOVER_FRAMES) {
        this.run = 0;
        this.quiet = HANGOVER_FRAMES + 1;
      }
      // Noise floor: fall fast, rise slowly, and only learn from non-speech.
      this.noiseFloor = rms < this.noiseFloor ? this.noiseFloor * 0.8 + rms * 0.2 : this.noiseFloor + (rms - this.noiseFloor) * 0.003;
    }

    this.history[this.head] = isSpeech ? 1 : 0;
    this.head = (this.head + 1) % HISTORY_FRAMES;
    this.framesSeen++;
  }

  /** True once enough of the caller's own speech has been heard to know their volume. */
  isCalibrated(): boolean {
    return this.speechFrameCount >= this.calibFrames;
  }

  /** Length of the current uninterrupted run of caller speech, in ms (0 when silent). */
  get speechRunMs(): number {
    return this.run * VAD_FRAME_MS;
  }

  /** Milliseconds of caller speech within the last `windowMs` (max 2000). */
  recentSpeechMs(windowMs: number): number {
    const frames = Math.min(HISTORY_FRAMES, this.framesSeen, Math.ceil(windowMs / VAD_FRAME_MS));
    let count = 0;
    for (let i = 1; i <= frames; i++) {
      count += this.history[(this.head - i + HISTORY_FRAMES) % HISTORY_FRAMES];
    }
    return count * VAD_FRAME_MS;
  }

  /** Caller speech accumulated since the last resetTurn() — "was anyone actually talking this turn?" */
  get turnSpeechMs(): number {
    return this.turnSpeechFrames * VAD_FRAME_MS;
  }

  resetTurn(): void {
    this.turnSpeechFrames = 0;
  }
}
