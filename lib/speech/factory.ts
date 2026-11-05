import { DeepgramSpeakStream } from "../deepgram/tts-stream";
import { GnaniSpeakStream } from "../tts/gnani-stream";
import type { GnaniLanguage } from "../tts/gnani";
import type { GnaniModel } from "../tts/gnani-voices";
import { DeepgramSttAdapter, DeepgramTtsAdapter } from "./deepgram-adapter";
import { GnaniLiveSttWrapper, GnaniTtsEngine } from "./gnani-adapter";
import type { LiveSttConnection, LiveSttOptions, SpeakStreamHandle, SpeakStreamOptions, SpeechProvider, TtsEngine } from "./types";

/** The single place a call site constructs a live STT connection instead of
 * importing lib/deepgram/live.ts directly — see lib/speech/types.ts. */
export function createLiveStt(provider: SpeechProvider, opts: LiveSttOptions): LiveSttConnection {
  if (provider === "gnani") return new GnaniLiveSttWrapper(opts);
  return new DeepgramSttAdapter(opts);
}

/** The single place a call site constructs a buffered TTS engine (the
 * ElevenLabs-override fallback path, filler phrases, standalone scripts) —
 * NOT the main streaming call path, see createSpeakStream() below.
 * `language`/`voice`/`model` are only meaningful for Gnani — Deepgram stays
 * English-only (see the plan's decision). */
export function createTtsEngine(provider: SpeechProvider, language: string, voice?: string, gnaniModel?: string): TtsEngine {
  if (provider === "gnani") return new GnaniTtsEngine(language as GnaniLanguage, voice, gnaniModel as GnaniModel | undefined);
  return new DeepgramTtsAdapter();
}

/** The single place a call site opens a persistent streaming TTS connection
 * — the main low-latency call path (clause-by-clause as the LLM generates),
 * instead of importing DeepgramSpeakStream/GnaniSpeakStream directly. Both
 * already structurally satisfy SpeakStreamHandle (lib/speech/types.ts). */
export function createSpeakStream(
  provider: SpeechProvider,
  opts: SpeakStreamOptions,
  onAudioChunk: (chunk: Buffer) => void
): SpeakStreamHandle {
  if (provider === "gnani") {
    return new GnaniSpeakStream(
      {
        voice: opts.voice,
        model: (opts.gnaniModel as GnaniModel) ?? "timbre-v2.5",
        language: opts.language as GnaniLanguage,
        sampleRate: opts.sampleRate,
      },
      onAudioChunk
    );
  }
  return new DeepgramSpeakStream({ model: opts.voice, encoding: "linear16", sampleRate: opts.sampleRate }, onAudioChunk);
}
