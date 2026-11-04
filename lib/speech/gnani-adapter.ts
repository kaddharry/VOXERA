import WebSocket from "ws";
import { synthesizeGnaniLinear16, type GnaniLanguage } from "../tts/gnani";
import { DEFAULT_GNANI_VOICE, type GnaniModel } from "../tts/gnani-voices";
import type { LiveSttConnection, LiveSttOptions, TtsEngine, TtsSynthOpts } from "./types";

const GNANI_STT_URL = "wss://api.vachana.ai/stt/v3/stream";

interface GnaniSttHeaderConfig {
  language_code: string;
  model: "prisma-v2.5" | "prisma-v3.0";
  format: "verbatim" | "codemix";
}

/**
 * Maps our internal language code (lib/tts/gnani.ts's GnaniLanguage) to the
 * STT WS's header config. "auto" needs prisma-v3.0's indic-auto detection;
 * "hi-en" (Hinglish) is the closest match to prisma-v3.0's "codemix" format,
 * which Gnani's own docs never explicitly call "Hinglish" — this is a
 * judgment call pending real-call verification, not a documented 1:1
 * guarantee. Every other code is a plain language, handled by the v2.5
 * default model with literal ("verbatim") transcription.
 */
function resolveGnaniSttConfig(language: GnaniLanguage): GnaniSttHeaderConfig {
  if (language === "auto") {
    return { language_code: "indic-auto", model: "prisma-v3.0", format: "verbatim" };
  }
  if (language === "hi-en") {
    return { language_code: "hi-IN", model: "prisma-v3.0", format: "codemix" };
  }
  return { language_code: language, model: "prisma-v2.5", format: "verbatim" };
}

/**
 * Real-time Gnani/Vachana STT over wss://api.vachana.ai/stt/v3/stream.
 * Unlike DeepgramLiveWrapper, Gnani's own server-side VAD already decides
 * utterance boundaries — every `transcript` message it sends is final
 * (confirmed via their docs: `is_final` is always true), so there's no
 * two-stage word-group buffering to do here, just forward each transcript
 * straight through. `speech_start` is Gnani's VAD-onset signal, mapped to
 * onSpeechStarted the same way Deepgram's `SpeechStarted` event is.
 *
 * Audio must be sent as EXACT 1024-byte (512-sample) PCM16LE frames at
 * real-time cadence, not whatever chunk size the caller happens to hand in
 * — Twilio's own frames arrive as 320-byte PCM every 20ms, so this wrapper
 * accumulates them into an internal buffer and only sends once 1024 bytes
 * are available. Because the input itself already arrives at real-time
 * cadence, re-bucketing it this way naturally paces the output the same way
 * (~64ms apart at 8kHz) without needing an artificial timer.
 */
export class GnaniLiveSttWrapper implements LiveSttConnection {
  public readonly provider = "gnani" as const;
  private static readonly FRAME_BYTES = 1024;

  private ws: WebSocket | null = null;
  private readonly onTranscriptCb: LiveSttOptions["onTranscript"];
  private readonly onSpeechStartedCb?: () => void;
  private readonly sampleRate: number;
  private readonly language: GnaniLanguage;
  private pcmBuffer: Buffer = Buffer.alloc(0);
  private closed = false;

  constructor(opts: LiveSttOptions) {
    this.onTranscriptCb = opts.onTranscript;
    this.onSpeechStartedCb = opts.onSpeechStarted;
    this.sampleRate = opts.sampleRate;
    this.language = (opts.language as GnaniLanguage) || "hi-en";
  }

  public async connect(): Promise<void> {
    const apiKey = process.env.GNANI_API_KEY;
    if (!apiKey) throw new Error("GNANI_API_KEY is not set");

    const { language_code, model, format } = resolveGnaniSttConfig(this.language);

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(GNANI_STT_URL, {
        headers: {
          "x-api-key-id": apiKey,
          language_code,
          model,
          "x-sample-rate": String(this.sampleRate),
          format,
          // Default idle timeout is only 60s (confirmed against Gnani's docs:
          // https://docs.gnani.ai/api/STT/limits) — too short for a live
          // phone call, where a caller on hold, a long agent reply with no
          // caller speech, or just a thinking pause can easily exceed that
          // and silently drop the STT connection, leaving the agent deaf for
          // the rest of the call. 900 is the documented max.
          "x-idle-timeout-sec": "900",
        },
      });
      this.ws = socket;
      let settled = false;

      socket.once("open", () => {
        settled = true;
        console.log(`[Gnani STT] Connected (language=${language_code}, model=${model}, format=${format}, sample_rate=${this.sampleRate}).`);
        resolve();
      });

      socket.on("message", (data: WebSocket.RawData) => {
        try {
          this.handleMessage(JSON.parse(data.toString()));
        } catch {
          // ignore malformed/non-JSON frames
        }
      });

      socket.once("error", (err: Error) => {
        console.error("[Gnani STT] Error:", err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      socket.on("close", (code: number, reason: Buffer) => {
        console.log(`[Gnani STT] Connection closed. code=${code} reason="${reason.toString()}"`);
        this.ws = null;
      });
    });
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "speech_start":
        this.onSpeechStartedCb?.();
        break;
      case "transcript": {
        const text = typeof msg.text === "string" ? msg.text.trim() : "";
        if (text.length > 0) this.onTranscriptCb(text, true);
        break;
      }
      case "error":
        console.error("[Gnani STT] Server error:", msg.message);
        break;
      // "connected", "processing", "settings_updated" — informational, no-op.
    }
  }

  public sendAudio(buf: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.pcmBuffer = this.pcmBuffer.length > 0 ? Buffer.concat([this.pcmBuffer, buf]) : buf;
    while (this.pcmBuffer.length >= GnaniLiveSttWrapper.FRAME_BYTES) {
      this.ws.send(this.pcmBuffer.subarray(0, GnaniLiveSttWrapper.FRAME_BYTES));
      this.pcmBuffer = this.pcmBuffer.subarray(GnaniLiveSttWrapper.FRAME_BYTES);
    }
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pcmBuffer = Buffer.alloc(0);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // socket may already be closing
      }
      this.ws = null;
    }
  }
}

/** The buffered (non-streaming) Gnani TTS path — used only for the tenant's
 * ElevenLabs-override case falling through to this as a fallback shape, and
 * by standalone scripts. The real call path uses GnaniSpeakStream (streaming)
 * via lib/speech/factory.ts's createSpeakStream() instead. */
export class GnaniTtsEngine implements TtsEngine {
  public readonly provider = "gnani" as const;
  private readonly language: GnaniLanguage;
  private readonly voice: string;
  private readonly model: GnaniModel;

  constructor(language: GnaniLanguage, voice?: string, model?: GnaniModel) {
    this.language = language;
    this.voice = voice ?? DEFAULT_GNANI_VOICE.id;
    this.model = model ?? DEFAULT_GNANI_VOICE.model;
  }

  public synthesizeLinear16(text: string, _opts?: TtsSynthOpts): Promise<Buffer> {
    return synthesizeGnaniLinear16(text, { voice: this.voice, model: this.model, language: this.language });
  }
}
