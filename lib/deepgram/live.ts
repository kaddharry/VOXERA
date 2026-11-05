import WebSocket from "ws";
import { CONFIG } from "../config";

export type TranscriptCallback = (text: string, isFinal: boolean) => void;

export type ConnectionState = "disconnected" | "connecting" | "connected";

/**
 * Builds the Deepgram live-listen query params — pulled out of connect() so
 * the model/language/hint logic (BUG-E19) is unit-testable without mocking
 * a WebSocket connection or DEEPGRAM_API_KEY.
 */
export function buildListenParams(sampleRate: number, opts?: { codeSwitching?: boolean }): URLSearchParams {
  // BUG-E19: opt-in Hindi/English code-switching (see CONFIG.deepgram
  // .sttHindiCodeSwitching's doc comment for why this isn't the default).
  // Off: unchanged nova-2/en, exactly today's production behavior. `opts`
  // lets tests override without fighting CONFIG's `as const` readonly-ness.
  const codeSwitching = opts?.codeSwitching ?? CONFIG.deepgram.sttHindiCodeSwitching;
  const params = new URLSearchParams({
    model: codeSwitching ? "nova-3" : "nova-2",
    ...(codeSwitching ? { language: "multi" } : { language: "en" }),
    smart_format: "true",
    encoding: "linear16",
    sample_rate: String(sampleRate),
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
    endpointing: String(CONFIG.stt.endpointingMs),
    utterance_end_ms: String(CONFIG.stt.utteranceEndMs),
    vad_events: "true",
  });
  if (codeSwitching) {
    // Deepgram's docs example repeats this param: language_hint=hi&language_hint=en
    // — URLSearchParams needs .append() for that (the object constructor
    // above can't hold two values under one key). Biases detection toward
    // these two languages without restricting to only them.
    params.append("language_hint", "hi");
    params.append("language_hint", "en");
    // Recommended by Deepgram's code-switching docs for streaming.
    params.set("endpointing", "100");
  }
  return params;
}

export interface DeepgramLiveOptions {
  /** Sample rate in Hz. Use 16000 for browser audio, 8000 for Twilio telephony. */
  sampleRate?: number;
  /** Maximum reconnection attempts before giving up. */
  maxReconnects?: number;
  /** Fires on Deepgram's own VAD-driven `SpeechStarted` event (requires
   * vad_events=true, already always on) — i.e. Deepgram itself detected the
   * caller starting to talk, independent of any raw energy/RMS threshold a
   * caller might layer on top. Useful as a barge-in trigger that's immune to
   * the false-trigger/miss-trigger tradeoffs of a fixed RMS cutoff. */
  onSpeechStarted?: () => void;
  /** Resolved call language (lib/speech/resolve.ts) — e.g. "en-IN", "hi-IN",
   * "hi-en", "auto". BUG-E19 used to gate Hindi/English code-switching
   * (nova-3 + language=multi) behind a single global config flag
   * (CONFIG.deepgram.sttHindiCodeSwitching) that defaulted off for EVERY
   * call regardless of what language that call was actually configured
   * for — live-reproduced: a tenant/agent explicitly configured for Hindi
   * or Hinglish but left on the Deepgram provider still got nova-2+en STT,
   * silently mistranscribing (or failing to transcribe at all) non-English
   * speech. When this is set to anything other than English, code-switching
   * is turned on for THIS call only — an English-configured call (unset, or
   * "en"/"en-IN"/"en-US") is completely unaffected, so there's no latency/
   * cost change for the common English case. */
  language?: string;
}

const ENGLISH_LANGUAGE_CODES = new Set(["en", "en-IN", "en-US", "English"]);

/** Whether this call's resolved language should turn on Deepgram's Hindi/
 * English code-switching (nova-3 + language=multi) — see
 * DeepgramLiveOptions.language's doc above. "auto" and every non-English
 * Indian-language code VOXERA supports (lib/tts/gnani.ts's GnaniLanguage)
 * all route through this, since nova-3's code-switching is Hindi+English
 * specifically (not a true multi-language model) — it's still the closest
 * available improvement over a hard English-only model for any of them. */
function wantsCodeSwitching(language: string | undefined): boolean {
  return !!language && !ENGLISH_LANGUAGE_CODES.has(language);
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
  private onSpeechStarted: (() => void) | null = null;
  private readonly codeSwitching: boolean;

  constructor(onTranscript?: TranscriptCallback, opts?: DeepgramLiveOptions) {
    if (onTranscript) {
      this.onTranscript = onTranscript;
    }
    this.sampleRate = opts?.sampleRate ?? 16000;
    this.maxReconnects = opts?.maxReconnects ?? 3;
    this.onSpeechStarted = opts?.onSpeechStarted ?? null;
    // Per-call override — see DeepgramLiveOptions.language's doc. Falls
    // back to the global CONFIG default (still off) when no language was
    // passed in at all, same as buildListenParams' own default behavior.
    this.codeSwitching = opts?.language !== undefined ? wantsCodeSwitching(opts.language) : CONFIG.deepgram.sttHindiCodeSwitching;
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public async connect(): Promise<void> {
    this.intentionallyClosed = false;
    this.state = "connecting";

    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) throw new Error("DEEPGRAM_API_KEY is not set");

    const params = buildListenParams(this.sampleRate, { codeSwitching: this.codeSwitching });
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

    // Deepgram's own VAD onset signal (vad_events=true) — fires as soon as
    // it detects the caller starting to talk, ahead of any transcript.
    if (data && data.type === "SpeechStarted") {
      this.onSpeechStarted?.();
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
