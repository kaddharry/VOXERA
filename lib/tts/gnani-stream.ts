import WebSocket from "ws";
import { callGnaniTTS, type GnaniLanguage } from "./gnani";
import { isLatinText, synthesizeDeepgramRaw } from "./deepgram-fallback";
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
  /** Clauses waiting for the in-flight request to finish, in order. This used
   * to be a single slot that each new clause OVERWROTE, so when the LLM
   * produced clauses faster than Gnani synthesized them the middle ones were
   * silently dropped and the agent spoke only part of its reply. Barge-in
   * (clear()) still empties it, so interruptions stay instant. */
  private queue: string[] = [];
  /** The request currently being synthesized, for retry. */
  private current: { text: string; attempts: number; bytes: number } | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Gnani's synthesis endpoint intermittently answers "We are facing
   * technical difficulties" (measured: the same text fails and succeeds at
   * random). A failed clause used to be dropped, leaving a hole in the
   * reply, so each is retried before giving up. */
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly RETRY_DELAYS_MS = [100, 250, 500, 900];
  private failureHandler: ((text: string) => void) | null = null;

  /** Called with the text of a clause that could not be voiced at all (every retry and fallback failed), so the
   * caller can tell the user instead of leaving them waiting on a reply that will never be heard. */
  public setFailureHandler(cb: ((text: string) => void) | null): void {
    this.failureHandler = cb;
  }
  /** Safety net: if the server's "complete"/"error" for an in-flight
   * request is ever lost (dropped by the network, or arrives as a frame
   * that doesn't parse as JSON and hits connect()'s catch) `busy` would
   * otherwise stay true forever, silently queuing every later sendText()
   * and muting the agent for the rest of the call on an otherwise-healthy
   * connection. Same "don't trust a single signal to definitely fire"
   * pattern already used for Deepgram's UtteranceEnd fallback (see
   * lib/deepgram/live.ts's UTTERANCE_END_FALLBACK_MS) — generous relative
   * to a normal synthesis turnaround so it never fires on a merely slow
   * (not lost) response. */
  private static readonly COMPLETE_FALLBACK_MS = 8000;
  private completeFallbackTimer: ReturnType<typeof setTimeout> | null = null;

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

      socket.on("close", (code: number) => {
        // Only forget the socket if it is still the current one (a reconnect may already have replaced it).
        if (this.ws === socket) this.ws = null;
        if (!this.closed) console.warn(`[Gnani Speak] Connection closed by the server (code ${code}) — will reconnect on the next sentence.`);
      });
    });
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "audio": {
        const data = msg.data as { audio?: string } | undefined;
        if (data?.audio) {
          const chunk = Buffer.from(data.audio, "base64");
          if (this.current) this.current.bytes += chunk.length;
          this.onAudioChunk(chunk);
        }
        break;
      }
      case "complete":
        this.clearCompleteFallback();
        this.finishCurrent();
        break;
      case "error":
        console.warn("[Gnani Speak] Server error:", msg.message);
        this.clearCompleteFallback();
        this.handleFailure();
        break;
      // "start" — informational, no-op.
    }
  }

  private clearCompleteFallback(): void {
    if (this.completeFallbackTimer) {
      clearTimeout(this.completeFallbackTimer);
      this.completeFallbackTimer = null;
    }
  }

  /** Fires when no complete/error arrived within COMPLETE_FALLBACK_MS of a
   * request going out — see that constant's doc comment. */
  private forceComplete(): void {
    console.warn(`[Gnani Speak] No complete/error received within ${GnaniSpeakStream.COMPLETE_FALLBACK_MS}ms — forcing the stream unstuck instead of muting the rest of the call.`);
    this.completeFallbackTimer = null;
    this.finishCurrent();
  }

  /** The in-flight request finished (or was given up on): move to the next clause. */
  private finishCurrent(): void {
    this.current = null;
    this.busy = false;
    this.sendQueuedIfAny();
  }

  private sendQueuedIfAny(): void {
    const next = this.queue.shift();
    if (next !== undefined) this.start(next);
  }

  private start(text: string): void {
    this.current = { text, attempts: 1, bytes: 0 };
    this.sendRequest(text);
  }

  /** A synthesis request failed. Retry it (only when nothing of it was played
   * yet, so a retry can never repeat half a sentence); after the last attempt
   * try Gnani's REST endpoint once, then move on rather than stall the call. */
  private handleFailure(): void {
    const cur = this.current;
    if (!cur || this.closed) return this.finishCurrent();
    if (cur.bytes === 0 && cur.attempts < GnaniSpeakStream.MAX_ATTEMPTS) {
      const delay = GnaniSpeakStream.RETRY_DELAYS_MS[cur.attempts - 1] ?? 400;
      cur.attempts++;
      this.busy = true;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (this.closed || this.current !== cur) return; // barge-in cleared it meanwhile
        this.sendRequest(cur.text);
      }, delay);
      return;
    }
    if (cur.bytes === 0) {
      this.busy = true;
      void this.restFallback(cur);
      return;
    }
    console.warn("[Gnani Speak] Gave up mid-sentence after partial audio.");
    this.finishCurrent();
  }

  private async restFallback(cur: { text: string; attempts: number; bytes: number }): Promise<void> {
    try {
      const audio = await callGnaniTTS({
        text: cur.text,
        voice: this.opts.voice,
        model: this.opts.model,
        language: this.opts.language,
        speed: this.opts.speed,
        audioConfig: { sample_rate: this.opts.sampleRate, num_channels: 1, sample_width: 2, encoding: "linear_pcm", container: "raw" },
      });
      if (!this.closed && this.current === cur && audio.length > 0) {
        this.onAudioChunk(audio);
        return this.finishCurrent();
      }
    } catch (err) {
      console.warn("[Gnani Speak] REST fallback failed too:", err instanceof Error ? err.message : err);
    }
    // Gnani is down. English clauses can still be voiced by Deepgram (a different voice beats a hole in the reply).
    let voiced = false;
    if (this.current === cur && !this.closed && isLatinText(cur.text)) {
      try {
        const audio = await synthesizeDeepgramRaw(cur.text, this.opts.sampleRate);
        if (!this.closed && this.current === cur && audio.length > 0) {
          this.onAudioChunk(audio);
          voiced = true;
        }
        console.warn("[Gnani Speak] Voiced one clause with the Deepgram fallback.");
      } catch (err) {
        console.warn("[Gnani Speak] Deepgram fallback failed too — skipping this clause:", err instanceof Error ? err.message : err);
      }
    }
    if (!voiced && !this.closed && this.current === cur) this.failureHandler?.(cur.text);
    if (this.current === cur) this.finishCurrent();
  }

  private sendRequest(text: string): void {
    if (this.closed) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // The server closed the (long-lived) socket, e.g. after sitting idle. This used to return silently, so the
      // agent stopped speaking for the rest of the call with no error anywhere. Reconnect, then send.
      this.busy = true;
      this.clearCompleteFallback();
      this.completeFallbackTimer = setTimeout(() => this.forceComplete(), GnaniSpeakStream.COMPLETE_FALLBACK_MS);
      void this.connect()
        .then(() => {
          if (this.closed) return;
          console.warn("[Gnani Speak] Reconnected.");
          this.sendRequest(text);
        })
        .catch((err) => {
          console.warn("[Gnani Speak] Reconnect failed:", err instanceof Error ? err.message : err);
          this.clearCompleteFallback();
          this.handleFailure();
        });
      return;
    }
    this.busy = true;
    this.clearCompleteFallback();
    this.completeFallbackTimer = setTimeout(() => this.forceComplete(), GnaniSpeakStream.COMPLETE_FALLBACK_MS);
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
   * protocol doesn't support more than one at a time), the new text is queued
   * (in order, nothing is overwritten) and sent as soon as the current one finishes.
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
      this.queue.push(text);
      return;
    }
    this.start(text);
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
    this.queue = [];
    // A request waiting to be retried is part of the reply being interrupted.
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.current = null;
      this.clearCompleteFallback();
      this.busy = false;
    }
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearCompleteFallback();
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
