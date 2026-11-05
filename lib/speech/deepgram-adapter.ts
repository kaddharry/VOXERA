import { DeepgramLiveWrapper } from "../deepgram/live";
import { synthesizeLinear16 } from "../deepgram/tts";
import type { LiveSttConnection, LiveSttOptions, TtsEngine, TtsSynthOpts } from "./types";

/**
 * Pure wrapper around the existing Deepgram STT/TTS code — delegates every
 * call, no behavior change beyond one thing: `opts.language` now turns on
 * Deepgram's Hindi/English code-switching (nova-3 + language=multi) for
 * this one connection when it's anything other than English — see
 * DeepgramLiveOptions.language's doc in lib/deepgram/live.ts for why this
 * replaced the old "always English, full stop" behavior. TTS stays
 * English-only regardless (DeepgramTtsAdapter below) — that part of the
 * plan's original decision is unchanged, only the STT side had a real,
 * live-reproduced mistranscription bug.
 */
export class DeepgramSttAdapter implements LiveSttConnection {
  public readonly provider = "deepgram" as const;
  private wrapper: DeepgramLiveWrapper;

  constructor(opts: LiveSttOptions) {
    this.wrapper = new DeepgramLiveWrapper(opts.onTranscript, {
      sampleRate: opts.sampleRate,
      onSpeechStarted: opts.onSpeechStarted,
      language: opts.language,
    });
  }

  connect(): Promise<void> {
    return this.wrapper.connect();
  }

  sendAudio(buf: Buffer): void {
    this.wrapper.sendAudio(buf);
  }

  close(): void {
    this.wrapper.close();
  }
}

export class DeepgramTtsAdapter implements TtsEngine {
  public readonly provider = "deepgram" as const;

  synthesizeLinear16(text: string, opts?: TtsSynthOpts): Promise<Buffer> {
    return synthesizeLinear16(text, opts);
  }
}
