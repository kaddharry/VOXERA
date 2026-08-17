import WebSocket from "ws";

export type TranscriptCallback = (text: string, isFinal: boolean) => void;

export type ConnectionState = "disconnected" | "connecting" | "connected";

export interface DeepgramLiveOptions {
  /** Sample rate in Hz. Use 16000 for browser audio, 8000 for Twilio telephony. */
  sampleRate?: number;
  /** Maximum reconnection attempts before giving up. */
  maxReconnects?: number;
}

/**
 * Deepgram Live STT wrapper with auto-reconnection.
 *
 * Connects directly via a raw WebSocket rather than @deepgram/sdk's
 * `listen.v1.connect()` helper. That SDK wrapper (backed by its own
 * "ReconnectingWebSocket" abstraction) was silently killing the connection
 * after only a handful of audio frames with no error or close reason
 * surfaced anywhere — confirmed by isolating every other layer (raw audio
 * bytes over a bare `ws` server: fine; the same audio streamed straight to
 * Deepgram's live endpoint with a plain `ws.WebSocket`: fine, real
 * transcripts back). Bypassing the SDK for this path removes the bug.
 *
 * Issue #8: Added configurable sample rate (fixes 16kHz vs 8kHz mismatch for Twilio),
 * automatic reconnection with exponential backoff, and audio buffering during reconnects.
 */
export class DeepgramLiveWrapper {
  private live: WebSocket | null = null;
  private onTranscript: TranscriptCallback | null = null;
  private sampleRate: number;
  private maxReconnects: number;
  private reconnectAttempts = 0;
  private state: ConnectionState = "disconnected";
  private audioBuffer: (Uint8Array | Buffer)[] = [];
  private intentionallyClosed = false;
  /** is_final segments accumulated since the last UtteranceEnd — a single
   * is_final=true Results message is a finalized WORD GROUP, not "the caller
   * stopped talking"; treating it as a whole turn is what caused a sentence
   * with a mid-sentence thinking pause ("...tell me about your <pause>
   * experience in Salesforce?") to be split into two separate turns. */
  private finalSegments: string[] = [];
  /** Safety net: if Deepgram's UtteranceEnd (driven by vad_events) never
   * arrives after a final segment lands — flaky network, an unexpected
   * response shape — the turn would otherwise never fire and the agent
   * would go silent. Forces finalization after this many ms of no further
   * activity, same "don't trust a single signal to definitely fire" pattern
   * already used for the LLM tool-loop fallback in lib/agent/llm.ts. */
  private static readonly UTTERANCE_END_FALLBACK_MS = 2500;
  private utteranceFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(onTranscript?: TranscriptCallback, opts?: DeepgramLiveOptions) {
    if (onTranscript) {
      this.onTranscript = onTranscript;
    }
    this.sampleRate = opts?.sampleRate ?? 16000;
    this.maxReconnects = opts?.maxReconnects ?? 3;
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public async connect(): Promise<void> {
    this.intentionallyClosed = false;
    this.state = "connecting";

    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) throw new Error("DEEPGRAM_API_KEY is not set");

    const params = new URLSearchParams({
      model: "nova-2",
      language: "en",
      smart_format: "true",
      encoding: "linear16",
      sample_rate: String(this.sampleRate),
      channels: "1",
      interim_results: "true",
      // `is_final` on a Results message means "this word group is finalized
      // and won't be re-transcribed" — it does NOT mean the caller stopped
      // talking. Treating every is_final segment as a complete turn (the
      // previous behavior) meant an ordinary mid-sentence thinking pause
      // ("...tell me about your <pause> experience in Salesforce?") got
      // split into two separate turns, the first answered as if it were a
      // complete (fragment) question. `endpointing: 900` still controls how
      // eagerly each word group gets marked is_final — kept as-is. The real
      // "caller is done talking" signal is UtteranceEnd, which requires
      // vad_events=true to be emitted at all; handleTranscript() below now
      // buffers is_final segments and only fires a turn-triggering callback
      // on UtteranceEnd, using utterance_end_ms as the silence gap for that
      // decision specifically.
      endpointing: "900",
      utterance_end_ms: "1000",
      vad_events: "true",
    });
    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url, { headers: { Authorization: `Token ${key}` } });
      this.live = socket;
      let settled = false;

      socket.once("open", () => {
        settled = true;
        this.state = "connected";
        this.reconnectAttempts = 0;
        console.log(`[Deepgram Live] Connected (sample_rate=${this.sampleRate}).`);

        // Flush any audio buffered during reconnection
        if (this.audioBuffer.length > 0) {
          console.log(`[Deepgram Live] Flushing ${this.audioBuffer.length} buffered audio chunks.`);
          for (const chunk of this.audioBuffer) {
            this.sendAudio(chunk);
          }
          this.audioBuffer = [];
        }
        resolve();
      });

      socket.on("message", (data: WebSocket.RawData) => {
        try {
          this.handleTranscript(JSON.parse(data.toString()));
        } catch {
          // ignore malformed frames
        }
      });

      socket.once("error", (err: Error) => {
        console.error("[Deepgram Live] Error:", err);
        if (!settled) {
          settled = true;
          reject(err);
        }
        this.handleDisconnect();
      });

      socket.on("close", (code: number, reason: Buffer) => {
        console.log(`[Deepgram Live] Connection closed. code=${code} reason="${reason.toString()}"`);
        this.handleDisconnect();
      });
    });
  }

  private async handleDisconnect(): Promise<void> {
    if (this.intentionallyClosed) return;
    if (this.state === "connecting") return; // already reconnecting

    this.state = "disconnected";
    this.live = null;

    if (this.reconnectAttempts >= this.maxReconnects) {
      console.error(
        `[Deepgram Live] Max reconnection attempts (${this.maxReconnects}) reached. Giving up.`,
      );
      return;
    }

    this.reconnectAttempts++;
    const backoffMs = Math.pow(2, this.reconnectAttempts - 1) * 1000; // 1s, 2s, 4s
    console.warn(
      `[Deepgram Live] Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnects} in ${backoffMs}ms...`,
    );

    await new Promise((resolve) => setTimeout(resolve, backoffMs));

    try {
      await this.connect();
    } catch (err) {
      console.error("[Deepgram Live] Reconnection failed:", err);
      this.handleDisconnect();
    }
  }

  public sendAudio(buffer: Uint8Array | Buffer): void {
    if (this.state === "connected" && this.live && this.live.readyState === WebSocket.OPEN) {
      this.live.send(buffer);
    } else if (this.state === "connecting") {
      // Buffer audio during reconnection so we don't lose caller speech
      this.audioBuffer.push(buffer);
    }
  }

  public close(): void {
    this.intentionallyClosed = true;
    this.state = "disconnected";
    if (this.live) {
      this.live.close();
      this.live = null;
    }
    this.audioBuffer = [];
    this.finalSegments = [];
    this.clearUtteranceFallback();
  }

  private clearUtteranceFallback(): void {
    if (this.utteranceFallbackTimer) {
      clearTimeout(this.utteranceFallbackTimer);
      this.utteranceFallbackTimer = null;
    }
  }

  /** Joins accumulated is_final word-group segments into the finished
   * utterance and fires the turn-triggering callback (isFinal=true). */
  private finalizeUtterance(): void {
    this.clearUtteranceFallback();
    if (this.finalSegments.length === 0) return;
    const text = this.finalSegments.join(" ").trim();
    this.finalSegments = [];
    if (text.length > 0 && this.onTranscript) {
      this.onTranscript(text, true);
    }
  }

  private handleTranscript(data: any) {
    // UtteranceEnd (requires vad_events=true) is the real "caller stopped
    // talking" signal — this is the only place a full turn should fire from.
    if (data && data.type === "UtteranceEnd") {
      this.finalizeUtterance();
      return;
    }

    // Basic duck-typing for a transcript Results response vs other metadata
    if (data && data.channel && data.channel.alternatives) {
      const isFinal = data.is_final || false;
      const alternatives = data.channel.alternatives;
      if (!alternatives || alternatives.length === 0) return;

      const text = alternatives[0].transcript;
      if (!text || text.trim().length === 0) return;

      if (isFinal) {
        // A finalized word group, not necessarily the end of the turn —
        // buffer it and wait for UtteranceEnd. Still surface the growing
        // transcript to the caller as an interim update (isFinal=false) so
        // any live-caption UI keeps updating instead of appearing frozen.
        this.finalSegments.push(text.trim());
        if (this.onTranscript) {
          this.onTranscript(this.finalSegments.join(" "), false);
        }
        // Safety net in case UtteranceEnd never arrives for this utterance.
        this.clearUtteranceFallback();
        this.utteranceFallbackTimer = setTimeout(
          () => this.finalizeUtterance(),
          DeepgramLiveWrapper.UTTERANCE_END_FALLBACK_MS
        );
      } else if (this.onTranscript) {
        // True interim (not yet finalized) — show it appended to whatever
        // is already finalized so far, not in isolation.
        const preview = this.finalSegments.length > 0 ? `${this.finalSegments.join(" ")} ${text}` : text;
        this.onTranscript(preview, false);
      }
    }
  }
}
