"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Thin wrapper around @ricky0123/vad-web's MicVAD (Silero VAD via ONNX
 * Runtime Web). Its only job here is turn-taking signal — telling the UI
 * the instant the user starts/stops talking, independent of Deepgram's
 * server-side transcript finalization. Model/WASM/worklet assets are
 * self-hosted under public/vad/ (see baseAssetPath/onnxWASMBasePath below)
 * rather than fetched from a CDN, since the package resolves relative to
 * the page origin by default in a bundler context like Next.js.
 */

type MicVADInstance = {
  start: () => void;
  pause: () => void;
  destroy: () => void;
};

export interface VoiceActivityHandlers {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
}

export function useVoiceActivityDetection() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ready, setReady] = useState(false);
  const vadRef = useRef<MicVADInstance | null>(null);
  const handlersRef = useRef<VoiceActivityHandlers>({});

  const start = useCallback(async (
    handlers: VoiceActivityHandlers,
    shared?: { stream: MediaStream; audioContext: AudioContext }
  ) => {
    handlersRef.current = handlers;

    if (vadRef.current) {
      vadRef.current.start();
      return;
    }

    const { MicVAD } = await import("@ricky0123/vad-web");
    const vad = await MicVAD.new({
      model: "v5",
      baseAssetPath: "/vad/",
      onnxWASMBasePath: "/vad/",
      // Raised from the library's defaults (0.3/0.25) — with no acoustic
      // echo cancellation guarantee on the mic input (laptop speaker bleed
      // into a nearby mic isn't always fully cancelled by the browser's
      // built-in AEC), the agent's own TTS playback was crossing the
      // default thresholds and firing onSpeechStart while the user hadn't
      // said anything, cutting the agent off mid-reply. Genuine close-mic
      // speech reliably scores well above these higher thresholds; echo
      // bleed-through (quieter, filtered by speaker+mic+room) mostly does
      // not, while real interruptions still work.
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.45,
      // Reuse the caller's already-open mic MediaStream and AudioContext.
      // Two independent AudioContexts each calling createMediaStreamSource()
      // on the same MediaStream is not reliable across browsers — one path
      // can end up silently receiving silence instead of live audio (this
      // is what broke transcription after the two-context split). One
      // shared context is safe now that the caller's own capture path uses
      // an AudioWorkletNode too, not the legacy ScriptProcessorNode —
      // mixing those two audio subsystems on one context was the actual
      // cause of the earlier "No execution context available" crash.
      ...(shared
        ? {
            audioContext: shared.audioContext,
            getStream: async () => shared.stream,
            pauseStream: async () => {},
            resumeStream: async (s: MediaStream) => s,
          }
        : {}),
      onSpeechStart: () => {
        setIsSpeaking(true);
        handlersRef.current.onSpeechStart?.();
      },
      onSpeechEnd: () => {
        setIsSpeaking(false);
        handlersRef.current.onSpeechEnd?.();
      },
      onVADMisfire: () => {
        setIsSpeaking(false);
      },
    });

    vadRef.current = vad;
    setReady(true);
    vad.start();
  }, []);

  const stop = useCallback(() => {
    vadRef.current?.pause();
    setIsSpeaking(false);
  }, []);

  const destroy = useCallback(() => {
    vadRef.current?.destroy();
    vadRef.current = null;
    setReady(false);
    setIsSpeaking(false);
  }, []);

  return { start, stop, destroy, isSpeaking, ready };
}
