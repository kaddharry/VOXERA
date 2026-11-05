import type { EmotionLabel, PolicyDirectives } from "../types";

export type SpeechProvider = "deepgram" | "gnani";

export interface LiveSttOptions {
  /** 8000 for telephony, 16000 for the browser demo path. */
  sampleRate: number;
  /** Provider-specific language code, already resolved (see resolve.ts). */
  language: string;
  onTranscript: (text: string, isFinal: boolean) => void;
  /** Fires on the provider's own VAD "caller started talking" signal — used
   * as an early barge-in trigger, independent of any transcript text. */
  onSpeechStarted?: () => void;
}

/** Common shape both DeepgramLiveWrapper and GnaniLiveSttWrapper satisfy.
 * `onTranscript(text, isFinal)` means the same thing to callers regardless
 * of provider — HOW each provider decides `isFinal` differs internally
 * (Deepgram buffers word-groups until UtteranceEnd; Gnani's own server-side
 * VAD already finalizes each utterance, so every message it sends is final)
 * but TelephonyStreamHandler.onTranscript() doesn't need to know which. */
export interface LiveSttConnection {
  connect(): Promise<void>;
  sendAudio(buf: Buffer): void;
  close(): void;
  readonly provider: SpeechProvider;
}

export interface TtsSynthOpts {
  policy?: PolicyDirectives;
  persona?: string;
  emotion?: EmotionLabel;
  /** The caller's utterance this turn is replying to — see lib/deepgram/tts.ts's synthesize(). */
  callerText?: string;
  /** Only consulted by the Deepgram adapter, to preserve its existing
   * tenant-level ElevenLabs-custom-voice override (getClientVoiceSettings). */
  clientId?: string;
}

/** Common shape every provider's buffered (synth-then-send) TTS satisfies.
 * Used for the ElevenLabs-tenant-override path and the short fixed filler
 * phrase — not the main low-latency call path, see SpeakStreamHandle below. */
export interface TtsEngine {
  readonly provider: SpeechProvider;
  /** Raw 8kHz linear16 PCM, ready for mulaw encoding back to Twilio. */
  synthesizeLinear16(text: string, opts?: TtsSynthOpts): Promise<Buffer>;
}

/** A persistent, call-lifetime streaming TTS connection — the main
 * low-latency path (clause-by-clause: sendText+flush as each clause is
 * ready, instead of waiting for a full reply). Both DeepgramSpeakStream
 * (lib/deepgram/tts-stream.ts) and GnaniSpeakStream (lib/tts/gnani-stream.ts)
 * already satisfy this shape structurally — see lib/speech/factory.ts's
 * createSpeakStream(), the single place a call site constructs one instead
 * of importing a provider's stream class directly. */
export interface SpeakStreamHandle {
  connect(): Promise<void>;
  setAudioHandler(cb: (chunk: Buffer) => void): void;
  sendText(text: string): void;
  flush(): void;
  clear(): void;
  close(): void;
}

export interface SpeakStreamOptions {
  sampleRate: number;
  language: string;
  /** Deepgram: an Aura-2 model id (e.g. "aura-2-asteria-en"). Gnani: a voice
   * name (e.g. "Nalini") — see lib/tts/gnani-voices.ts. */
  voice: string;
  /** Gnani only — which Timbre model `voice` belongs to (voices are
   * model-specific, see gnani-voices.ts). Ignored for Deepgram. */
  gnaniModel?: string;
}
