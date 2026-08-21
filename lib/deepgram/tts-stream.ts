import WebSocket from "ws";

export type SpeakChunkCallback = (audio: Buffer) => void;

export interface DeepgramSpeakStreamOptions {
  model: string;
  /** "linear16" | "mulaw" | "alaw" */
  encoding: "linear16" | "mulaw" | "alaw";
  sampleRate: number;
}

/**
 * Streaming Deepgram Aura TTS client — raw `ws` WebSocket against
 * `wss://api.deepgram.com/v1/speak`, deliberately NOT the `@deepgram/sdk`
 * wrapper (`speak.v1.connect()`). DeepgramLiveWrapper (this package's STT
 * client, see live.ts) already documents that SDK wrapper silently killing
 * connections after a handful of frames with no error surfaced — staying on
 * a bare `ws` client here avoids the same class of bug for TTS.
 *
 * Protocol (verified against Deepgram's current TTS WebSocket docs):
 *   → {"type":"Speak","text":"..."}   queue text for synthesis
 *   → {"type":"Flush"}                render audio for everything queued so far
 *   → {"type":"Clear"}                discard queued/in-flight audio (barge-in)
 *   → {"type":"Close"}                flush + gracefully end the connection
 *   ← binary frames                   raw audio (encoding/sample_rate as configured)
 *   ← {"type":"Flushed","sequence_id"} confirms a Flush's audio is fully sent
 *   ← {"type":"Warning"/"Metadata"}    informational, non-fatal
 *
 * This is what makes "TTS starts speaking clause 1 while the LLM is still
 * generating clause 3" possible — sendText()+flush() per clause, forwarding
 * each binary frame to the caller (onAudioChunk) the instant it arrives,
 * instead of buffering an entire reply before any audio exists.
 */
export class DeepgramSpeakStream {
  private ws: WebSocket | null = null;
  private opts: DeepgramSpeakStreamOptions;
  private onAudioChunk: SpeakChunkCallback;

  /** Swaps which callback receives future audio frames without touching the
   * underlying WebSocket — lets a caller keep ONE connection alive for an
   * entire call (avoiding a ~50-150ms handshake on every turn) while still
   * rebinding a fresh, turn-scoped handler each time (e.g. one that closes
   * over that turn's own staleness/generation check). */
  public setAudioHandler(cb: SpeakChunkCallback): void {
    this.onAudioChunk = cb;
  }
  private onFlushed?: (sequenceId: number) => void;
  private onError?: (err: Error) => void;
  private closed = false;

  constructor(
    opts: DeepgramSpeakStreamOptions,
    onAudioChunk: SpeakChunkCallback,
    handlers?: { onFlushed?: (sequenceId: number) => void; onError?: (err: Error) => void }
  ) {
    this.opts = opts;
    this.onAudioChunk = onAudioChunk;
    this.onFlushed = handlers?.onFlushed;
    this.onError = handlers?.onError;
  }

  public async connect(): Promise<void> {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) throw new Error("DEEPGRAM_API_KEY is not set");

    const params = new URLSearchParams({
      model: this.opts.model,
      encoding: this.opts.encoding,
      sample_rate: String(this.opts.sampleRate),
      container: "none",
    });
    const url = `wss://api.deepgram.com/v1/speak?${params.toString()}`;

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url, { headers: { Authorization: `Token ${key}` } });
      this.ws = socket;
      let settled = false;

      socket.once("open", () => {
        settled = true;
        resolve();
      });

      socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) {
          this.onAudioChunk(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
          return;
        }
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "Flushed" && this.onFlushed) this.onFlushed(msg.sequence_id);
          else if (msg.type === "Warning") console.warn("[Deepgram Speak] Warning:", msg.description);
        } catch {
          // ignore malformed control frames
        }
      });

      socket.once("error", (err: Error) => {
        console.error("[Deepgram Speak] Error:", err);
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

  /** Queue text for synthesis — does not itself produce audio until flush(). */
  public sendText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "Speak", text }));
  }

  /** Render audio for everything queued so far. */
  public flush(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "Flush" }));
  }

  /** Discards queued/in-flight audio — used on barge-in to stop generating
   * audio nobody will hear. */
  public clear(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "Clear" }));
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "Close" }));
      } catch {
        // socket may already be closing
      }
      this.ws.close();
    }
    this.ws = null;
  }
}
