import { DeepgramLiveWrapper } from "../deepgram/live";
import { synthesizeLinear16 } from "../deepgram/tts";
import type { LiveSttConnection, LiveSttOptions, TtsEngine, TtsSynthOpts } from "./types";

/**
 * Pure wrapper around the existing Deepgram STT/TTS code — delegates every
 * call, no behavior change. DeepgramLiveWrapper's `language` is NOT
 * configurable here (lib/deepgram/live.ts hardcodes "en" by design — see the
 * plan's decision to keep Deepgram English-only for now); `opts.language` is
 * accepted on the interface only so Gnani and Deepgram share one call site in
 * resolve.ts/stream-handler.ts, it has no effect for Deepgram.
 */
export class DeepgramSttAdapter implements LiveSttConnection {
  public readonly provider = "deepgram" as const;
  private wrapper: DeepgramLiveWrapper;

  constructor(opts: LiveSttOptions) {
    this.wrapper = new DeepgramLiveWrapper(opts.onTranscript, {
      sampleRate: opts.sampleRate,
      onSpeechStarted: opts.onSpeechStarted,
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
