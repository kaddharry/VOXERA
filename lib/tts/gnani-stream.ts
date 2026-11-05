import WebSocket from "ws";
import type { GnaniLanguage } from "./gnani";
import type { GnaniModel } from "./gnani-voices";

const GNANI_TTS_WS_URL = "wss://api.vachana.ai/api/v1/tts";

export type SpeakChunkCallback = (audio: Buffer) => void;

export interface GnaniSpeakStreamOptions {
  voice: string;
  model: GnaniModel;
  language: GnaniLanguage;
  sampleRate: number;
  speed?: number;
}

/**
 * Streaming Gnani/Vachana TTS client — wss://api.vachana.ai/api/v1/tts,
 * raw `ws`, same reasoning as DeepgramSpeakStream (lib/deepgram/tts-stream.ts)
 * for avoiding an SDK wrapper.
 *
 * Protocol (per Gnani's TTS Realtime docs), noticeably different from
 * Deepgram's Speak/Flush/Clear model:
 *   → one JSON message = one full synthesis request:
 *     {"text","voice","model","language","speed","audio_config"}
 *   ← {"type":"start",...}
 *   ← {"type":"audio","data":{"chunk_index","audio":"<base64>","is_final":false}}  (repeated)
 *   ← {"type":"complete","data":{...,"is_final":true}}   — or {"type":"error",...}
 *
 * Gnani's docs document no Flush/Clear/cancel operation and say to send one
 * request at a time, waiting for `complete`/`error` before the next. This
 * class queues sendText() calls that arrive while a request is still
 * in-flight rather than interleaving them (which the protocol doesn't
 * support) — see sendText()'s doc comment for what that means for barge-in
 * latency, a real, intentional trade-off, not an oversight.
 *
 * Structurally matches DeepgramSpeakStream's public shape (connect/
 * setAudioHandler/sendText/flush/clear/close) so TelephonyStreamHandler can
 * use either through the same SpeakStreamHandle interface
 * (lib/speech/types.ts) without a provider-specific branch at the call site.
 */
export class GnaniSpeakStream {
  private ws: WebSocket | null = null;
  private opts: GnaniSpeakStreamOptions;
  private onAudioChunk: SpeakChunkCallback;
  private onError?: (err: Error) => void;
  private closed = false;

  /** True while a synthesis request has been sent but no complete/error has
   * arrived yet — Gnani's protocol only allows one in-flight request. */
  private busy = false;
  /** Text queued because sendText() was called while busy. Only the latest
   * call matters for our use (one clause at a time, same as the Deepgram
   * path's actual call pattern in stream-handler.ts) — queuing an array
   * would let a slow clause pile up several more behind it, which would
   * make barge-in latency worse, not better. */
  private queuedText: string | null = null;

  public setAudioHandler(cb: SpeakChunkCallback): void {
    this.onAudioChunk = cb;
  }

  constructor(opts: GnaniSpeakStreamOptions, onAudioChunk: SpeakChunkCallback, handlers?: { onError?: (err: Error) => void }) {
    this.opts = opts;
    this.onAudioChunk = onAudioChunk;
    this.onError = handlers?.onError;
  }

  public async connect(): Promise<void> {
    const apiKey = process.env.GNANI_API_KEY;
    if (!apiKey) throw new Error("GNANI_API_KEY is not set");

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(GNANI_TTS_WS_URL, {
        headers: { "X-API-Key-ID": apiKey, "Content-Type": "application/json" },
      });
      this.ws = socket;
      let settled = false;

      socket.once("open", () => {
        settled = true;
        resolve();
      });

      socket.on("message", (data: WebSocket.RawData) => {
        try {
          this.handleMessage(JSON.parse(data.toString()));
        } catch {
          // ignore malformed frames
        }
      });

      socket.once("error", (err: Error) => {
        console.error("[Gnani Speak] Error:", err);
        if (!settled) {
          settled = true;
          reject(err);
        }
        this.onError?.(err);
      });

      socket.on("close", () => {
        this.ws = null;
      });
    });
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "audio": {
        const data = msg.data as { audio?: string } | undefined;
        if (data?.audio) this.onAudioChunk(Buffer.from(data.audio, "base64"));
        break;
      }
      case "complete":
        this.busy = false;
        this.sendQueuedIfAny();
        break;
      case "error":
        console.warn("[Gnani Speak] Server error:", msg.message);
        this.busy = false;
        this.sendQueuedIfAny();
        break;
      // "start" — informational, no-op.
    }
  }

  private sendQueuedIfAny(): void {
    if (this.queuedText !== null) {
      const text = this.queuedText;
      this.queuedText = null;
      this.sendRequest(text);
    }
  }

  private sendRequest(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.busy = true;
    this.ws.send(
      JSON.stringify({
        text,
        voice: this.opts.voice,
        model: this.opts.model,
        language: this.opts.language,
        speed: this.opts.speed ?? 1.0,
        audio_config: {
          sample_rate: this.opts.sampleRate,
          num_channels: 1,
          sample_width: 2,
          encoding: "linear_pcm",
          container: "raw",
        },
      })
    );
  }

  /**
   * Queues text for synthesis — unlike DeepgramSpeakStream, Gnani's
   * protocol synthesizes immediately on send (there's no separate queue+
   * flush step), so this already does what flush() does for Deepgram. flush()
   * below is a no-op kept only so stream-handler.ts's existing
   * `sendText(); flush();` call pattern works unchanged for both providers.
   *
   * If a request is already in flight (no complete/error yet — Gnani's
   * protocol doesn't support more than one at a time), the new text replaces
   * whatever was queued and is sent as soon as the current one finishes.
   * This is the real latency cost of Gnani's protocol vs Deepgram's
   * Flush/Clear model: on barge-in, a new reply's first clause may have to
   * wait out the tail of a request that was already in flight when the
   * caller interrupted, rather than cutting it off instantly server-side.
   * TelephonyStreamHandler's existing generation-counter check still drops
   * the interrupted request's audio client-side the moment it arrives, so
   * the caller never HEARS the stale reply — only the next reply's start
   * can be delayed by it.
   */
  public sendText(text: string): void {
    if (this.busy) {
      this.queuedText = text;
      return;
    }
    this.sendRequest(text);
  }

  /** No-op — see sendText()'s doc comment. Kept for interface parity with DeepgramSpeakStream. */
  public flush(): void {
    // intentionally empty
  }

  /** Drops anything queued client-side. Cannot cancel an already in-flight
   * server-side synthesis — Gnani's protocol has no Clear/cancel operation.
   * Audio from a request already in flight when this is called will still
   * arrive and still be decoded, but TelephonyStreamHandler's generation
   * check (set BEFORE calling clear()) already discards it before relaying
   * to Twilio — see this class's header comment. */
  public clear(): void {
    this.queuedText = null;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queuedText = null;
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
