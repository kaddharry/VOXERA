import { CallerSoundClock, TurnMarks } from "../realtime/turn-latency";
import { normalizeTranscript } from "../agent/transcript-language";
import { detectLanguageRequest, type RequestedLanguage } from "../agent/language-request";
import { emitSessionEvent } from "../realtime/emitter";
import { computeRmsEnergy } from "../audio/acoustic";
import { nanoid } from "nanoid";
import WebSocket from "ws";
import { resolveVoiceModel, getClientVoiceSettings } from "../deepgram/tts";
import { announceGreeting, handleTurn, recordInterruptedReply } from "../agent/orchestrator";
import { applyEmotionProsody, getEmotionTTSParams, type TTSProsodyParams } from "../emotion/tts-params";
import type { EmotionLabel, PolicyDirectives } from "../types";
import { supabase } from "../db/supabase";
import { getAgentWithTenantCached } from "../db/agent-cache";
import { acquireCallSlot, renewCallSlot, releaseCallSlot as releaseSlotLease, CALL_SLOT_RENEW_EVERY_MS } from "./call-coordination";
import { stm } from "../memory/stm";
import { sendSMS } from "./sms";
import { CONFIG } from "../config";
import { isMissingColumnError } from "../db/follow-up-tasks";
import { CallerVad } from "../audio/vad";
import { prewarmLlm } from "../agent/llm";
import { extractAcousticFeatures, isolateLastUtterance, upsample8kTo16kFloat32 } from "../audio/acoustic";
import { createLiveStt, createTtsEngine, createSpeakStream } from "../speech/factory";
import { DeepgramTtsAdapter } from "../speech/deepgram-adapter";
import { resolveSpeechConfig, warmTenantSpeechDefault } from "../speech/resolve";
import { parseGnaniPersona } from "../tts/gnani-voices";
import type { LiveSttConnection, SpeakStreamHandle, SpeechProvider, TtsEngine } from "../speech/types";

// Twilio sends audio as 8kHz mulaw (G.711 u-law). Deepgram needs linear16 PCM.
// We do a simple mulaw → linear16 decode in pure JS — no native deps.

const MULAW_DECODE_TABLE: number[] = (() => {
  const table: number[] = new Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i;
    const sign = u & 0x80;
    const exponent = (u >> 4) & 0x07;
    let mantissa = u & 0x0f;
    mantissa = (mantissa << 3) | 0x84;
    let sample = mantissa << exponent;
    sample -= 0x84;
    table[i] = sign !== 0 ? -sample : sample;
  }
  return table;
})();

function decodeMulaw(mulawBytes: Buffer): Buffer {
  const pcm = Buffer.alloc(mulawBytes.length * 2); // 16-bit per sample
  for (let i = 0; i < mulawBytes.length; i++) {
    const sample = MULAW_DECODE_TABLE[mulawBytes[i]];
    pcm.writeInt16LE(sample, i * 2);
  }
  return pcm;
}

// Encode linear16 PCM → mulaw (for TTS audio back to Twilio)
function encodeMulaw(pcmSample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = 0;
  if (pcmSample < 0) {
    sign = 0x80;
    pcmSample = -pcmSample;
  }
  if (pcmSample > CLIP) pcmSample = CLIP;
  pcmSample += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (pcmSample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) { }
  const mantissa = (pcmSample >> (exponent + 3)) & 0x0f;
  const mulawByte = ~(sign | (exponent << 4) | mantissa);
  return mulawByte & 0xff;
}

function pcmToMulaw(pcmBuffer: Buffer): Buffer {
  const mulaw = Buffer.alloc(pcmBuffer.length / 2);
  for (let i = 0; i < mulaw.length; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2);
    mulaw[i] = encodeMulaw(sample);
  }
  return mulaw;
}

// Twilio Media Streams expect audio delivered as a sequence of small frames,
// not one giant payload — 160 bytes = 20ms at 8kHz mulaw, the standard frame
// size. Splitting each Deepgram audio chunk into frames this size is also
// what makes barge-in actually responsive: the smaller each outbound `media`
// message is, the less already-sent-but-unplayed audio a `clear` event has
// to cut through.
const TWILIO_FRAME_BYTES = 160;

export interface StreamHandlerOptions {
  ws: WebSocket; // The WebSocket connection to Twilio
  callSid: string;
  clientId: string;
  callerNumber: string;
  /** The agent whose prompt/knowledge base should handle this call, resolved
   * from phone_numbers.agentId by the incoming webhook. Undefined falls back
   * to the tenant's default prompt (handleTurn's existing behavior). */
  agentId?: string;
  /** Roster patient (lib/db/patients.ts) being called — only ever set on an
   * outbound call placed from the Patients page. Undefined for every
   * genuine inbound call. */
  patientId?: string;
}

/** Listening sounds and acknowledgements — said while the agent talks, they aren't an interruption. */
const BACKCHANNEL_WORDS = new Set([
  "hmm", "hm", "mm", "mmm", "mhm", "mmhmm", "uh", "um", "uhm", "umm", "ah", "oh", "ohh", "er", "erm", "huh",
  "uhhuh", "yeah", "yes", "yep", "yup", "ok", "okay", "right", "sure", "alright", "fine", "i", "see", "got", "it", "aha",
  "mhmm", "ya", "yea", "cool", "great", "nice", "good", "true", "exactly", "correct", "indeed", "wow", "oof",
  // Hindi / Hinglish listening sounds (Devanagari and romanized) — the
  // old English-only list stripped Devanagari to nothing and so treated
  // EVERY Hindi sentence as "empty = backchannel", i.e. never an interruption.
  "हम्म", "हम", "हूँ", "हूं", "अं", "अह", "ओह", "आह", "हाँ", "हां", "हा", "जी", "अच्छा", "ठीक", "है", "सही", "बिल्कुल", "ओके", "अच्छा", "ऊँ",
  "haan", "han", "hanji", "ji", "jee", "accha", "acha", "achha", "theek", "thik", "hai", "sahi", "bilkul", "hmmm", "ohhh",
]);
/** Hesitation sounds only — no meaning at all, so even as a whole turn there is nothing to answer. */
const HESITATION_WORDS = new Set([
  "hmm", "hm", "mm", "mmm", "mhm", "mmhmm", "mhmm", "uh", "um", "uhm", "umm", "ah", "er", "erm", "huh", "hmmm", "uhhuh",
  "हम्म", "हम", "हूँ", "हूं", "अं", "अह", "ऊँ",
]);
/** Short words that do mean "stop" even on their own. */
const STOP_WORDS = new Set([
  "no", "stop", "wait", "hold", "sorry", "excuse", "hey", "hello",
  "नहीं", "नही", "रुको", "रुकिए", "रुकिये", "सुनो", "सुनिए", "ठहरो", "सुनिये", "माफ़", "सॉरी", "हेलो", "सुनिए",
  "nahi", "nahin", "ruko", "rukiye", "suno", "suniye", "sunna", "thehro",
]);

function tokenize(text: string): string[] {
  // Unicode-aware: \p{L}\p{M} keeps Devanagari letters and combining marks.
  return text.toLowerCase().replace(/['’-]/g, "").replace(/[^\p{L}\p{M}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

/** True when `text` is only listening noises/acknowledgements ("yeah okay", "hmm", "I see", "haan ji"). */
export function isBackchannel(text: string): boolean {
  const words = tokenize(text);
  if (words.length === 0) return true;
  if (words.some((w) => STOP_WORDS.has(w))) return false;
  return words.every((w) => BACKCHANNEL_WORDS.has(w));
}

/** True when `text` is nothing but "um/hmm/uh" — never worth a reply, even as a standalone turn. */
export function isHesitationOnly(text: string): boolean {
  const words = tokenize(text);
  return words.length > 0 && words.every((w) => HESITATION_WORDS.has(w));
}

/** A lone 1-2 letter fragment ("a", "the", "so") — the usual output of STT hearing background noise. */
export function isNoiseFragment(text: string): boolean {
  const words = tokenize(text);
  if (words.length === 0) return true;
  if (words.some((w) => STOP_WORDS.has(w))) return false;
  return words.length === 1 && [...words[0]].length <= 2;
}

/**
 * TelephonyStreamHandler manages the full real-time audio loop for one phone call.
 *
 * Lifecycle:
 *  1. Twilio opens a WebSocket (Media Stream) → this handler receives audio frames
 *  2. Audio is decoded mulaw → PCM → streamed to STT (Deepgram or Gnani,
 *     resolved per call — see lib/speech/)
 *  3. On final transcript → handleTurn() (orchestrator), streaming clause-by-clause
 *  4. Each clause → the resolved provider's streaming Speak connection
 *     (DeepgramSpeakStream or GnaniSpeakStream, both behind SpeakStreamHandle
 *     — see lib/speech/factory.ts's createSpeakStream()) → μ-law → sent to
 *     Twilio as soon as it's ready, not buffered until the whole reply is done
 *  5. Call ends → DB updated, queue updated
 *
 * Latency-overhaul notes (see /Users/vikasverma/.claude/plans/structured-zooming-quiche.md):
 *  - TTS is streamed so the caller starts hearing clause 1 while the LLM is
 *    still generating later clauses, instead of waiting for the entire reply
 *    to finish synthesizing. True for both providers — Gnani's streaming
 *    protocol differs from Deepgram's (no Flush/Clear, one request at a
 *    time — see GnaniSpeakStream's header comment for the barge-in latency
 *    trade-off that implies), but TelephonyStreamHandler doesn't need to
 *    know which is in play, both satisfy the same SpeakStreamHandle shape.
 *  - Barge-in uses the generation-counter pattern already proven in
 *    server.ts (the browser demo path): bumping `generation` invalidates
 *    whatever's in flight, so a stale turn's audio/clauses are dropped
 *    instead of racing with the caller's actual interruption.
 *  - On barge-in: cancels the in-flight LLM call (AbortController) and
 *    clears/closes the in-flight Speak stream, instead of only stopping
 *    Twilio playback of audio already sent.
 *  - A tenant's custom ElevenLabs voice (no streaming support at all) falls
 *    back to the original buffered synth-then-send path for that call only
 *    — see setupVoiceForCall(). The same buffered fallback also kicks in if
 *    the resolved provider's streaming connection itself fails to open
 *    (see ensureSpeakStream()'s catch).
 */
export class TelephonyStreamHandler {
  private ws: WebSocket;
  private callSid: string;
  private clientId: string;
  private callerNumber: string;
  private agentId?: string;
  private patientId?: string;
  private sessionId: string;
  private userId: string;
  private stt: LiveSttConnection;
  private streamSid: string | null = null;
  private startedAt: number;
  /** When the caller last made real sound — the start of the clock for "time to first word". */
  private callerSound = new CallerSoundClock();
  private isBusy = false; // prevent overlapping LLM turns
  private isSpeaking = false; // Issue #8: track if TTS is playing for barge-in
  /** The caller's sentence the in-flight turn is answering ("" when idle). */
  private currentTurnText = "";
  private hasEnded = false; // prevent double-invocation of onCallEnded
  private slotReleaseStarted = false;
  private slotRenewTimer: ReturnType<typeof setInterval> | null = null;

  // Issue #14: PCM accumulator for acoustic feature extraction
  private turnAudioChunks: Buffer[] = [];
  // Issue #14: Barge-in interruption counter (per turn, reset on each transcript)
  private turnInterruptionCount = 0;
  /** Twilio marks sent after reply audio and not yet echoed back — i.e. the
   * caller is still hearing the agent. See isAgentAudible(). */
  private pendingMarks = new Set<string>();
  private markSeq = 0;
  /** Local voice-activity detector on the caller's audio (lib/audio/vad.ts). */
  private vad = new CallerVad();
  /** Identity of the open Speak connection (provider|voice|language|model) —
   * lets a speculatively pre-opened default connection be swapped out if the
   * call's real voice turns out to differ. See prewarmSpeakStream(). */
  private speakStreamKey = "";
  /** The most recent in-flight transcript text while the agent was audible —
   * consulted by the energy barge-in so a "mm-hm" never triggers it. */
  private lastInterimWhileAudible = "";

  // Bumped on every barge-in — a turn whose captured generation no longer
  // matches this is stale and must not speak or be spoken over. Same
  // pattern already proven in server.ts for the browser demo path.
  private generation = 0;
  // Cancels the in-flight LLM generation for the current turn on barge-in.
  private currentAbortController: AbortController | null = null;
  // ONE Speak connection reused for the entire call (see
  // ensureSpeakStream()) — reachable from the barge-in handler (a different
  // method) so it can be cleared immediately instead of only stopping
  // Twilio playback of audio already sent.
  private currentSpeakStream: SpeakStreamHandle | null = null;
  private speakStreamReadyPromise: Promise<void> | null = null;

  // Resolved once per call (not per turn) in setupVoiceForCall() — an
  // agent's voice and a tenant's custom-voice provider don't change
  // mid-call, so there's no reason to re-resolve either on every reply.
  private voiceModel: string = CONFIG.deepgram.ttsModel;
  // Gnani-only — which voice/Timbre model this call's streaming TTS uses
  // (lib/tts/gnani-voices.ts). Unused when speechProvider is "deepgram".
  private gnaniVoice: string = "Nalini";
  private gnaniModel: string = "timbre-v2.5";
  // Only ever true for a tenant's custom ElevenLabs voice now — both
  // Deepgram and Gnani stream via ensureSpeakStream()/createSpeakStream().
  private useBufferedTts = false;
  private voiceSetupPromise: Promise<void> | null = null;

  // Resolved alongside voiceModel in setupVoiceForCall() — "deepgram" unless
  // the agent (or the tenant default, see lib/speech/resolve.ts) picks
  // Gnani. ttsEngine starts as the Deepgram adapter so a call that somehow
  // never reaches setupVoiceForCall still has a working buffered-TTS
  // fallback (speakBuffered, the ElevenLabs/filler-phrase path).
  private speechProvider: SpeechProvider = "deepgram";
  private language: string = "en-IN";
  /** Language the caller explicitly asked for on this call ("English mein baat karo") — kept for the whole call. */
  private languageLock: RequestedLanguage | null = null;
  private ttsEngine: TtsEngine = new DeepgramTtsAdapter();
  // Agent Builder's "greeting" field (lib/db/agents.ts's AgentRecord),
  // resolved alongside voice/provider in setupVoiceForCall() — spoken once,
  // proactively, as soon as voice setup resolves (see the "start" handler
  // below), instead of the agent only ever responding once the caller
  // speaks first.
  private greeting: string | null = null;

  constructor(opts: StreamHandlerOptions) {
    this.ws = opts.ws;
    this.callSid = opts.callSid;
    this.clientId = opts.clientId;
    this.callerNumber = opts.callerNumber;
    this.agentId = opts.agentId;
    this.patientId = opts.patientId;
    this.sessionId = `tel-${nanoid(12)}`;
    this.userId = `caller-${opts.callerNumber.replace(/\D/g, "")}`;
    this.startedAt = Date.now();

    // Barge-in is decided from the caller's words (onTranscript), not from
    // Deepgram's SpeechStarted VAD event or raw audio energy: both fire on a
    // cough, a "hmm" or background noise, which used to cut the agent off
    // mid-sentence and start a whole new reply ("double reply").
    // Eagerly opens the DEFAULT (Deepgram) connection — the real
    // provider/language isn't known until setupVoiceForCall() resolves on
    // the "start" event (needs clientId/agentId, see below). This preserves
    // the existing "don't lose early audio" latency optimization for the
    // common (Deepgram) case; setupVoiceForCall() tears this down and
    // reopens with the resolved provider only when it actually differs, so
    // only Gnani-routed calls pay that one extra reconnect.
    this.stt = createLiveStt("deepgram", {
      sampleRate: 8000,
      language: "en-IN",
      onTranscript: this.onTranscript.bind(this),
    });

    // Register every ws event handler in this same synchronous tick, before
    // awaiting anything in init() below — Node's EventEmitter drops events
    // fired before a listener is attached, and Twilio sends "connected"
    // then "start" within milliseconds of the WS opening. init() awaits a
    // real network round-trip to Deepgram before it used to reach this
    // wiring, which silently dropped "start" (never setting streamSid) on
    // real calls: STT still worked once later "media" frames arrived after
    // the listener attached, but every speak call after that silently
    // no-op'd on `if (!this.streamSid) return;` — the caller heard nothing
    // back despite the agent generating real replies. Same bug class
    // server.ts's realtime demo path already documents fixing.
    this.ws.on("message", (data: Buffer) => this.onTwilioMessage(data));
    this.ws.on("close", (code: number, reason: Buffer) => {
      console.info(JSON.stringify({ service: "telephony", event: "websocket_closed", timestamp: new Date().toISOString(), callSid: this.callSid, streamSid: this.streamSid, sessionId: this.sessionId, closeCode: code, closeReason: reason.toString() }));
      this.onCallEnded();
    });
    this.ws.on("error", (err) => {
      console.error(`[TelephonyStream] WebSocket error on ${this.callSid}:`, err);
      this.onCallEnded();
    });

    // Warm the LLM provider connection now, while Twilio is still doing its
    // handshake, so the first reply doesn't pay a cold TLS connect.
    prewarmLlm();

    this.init().catch((err) => this.onInitFailed(err));
  }

  private async init() {
    // The call slot itself is a lease taken by the incoming webhook (keyed
    // by CallSid, in Postgres) and kept alive from the "start" event on —
    // see holdCallSlot(). Nothing to acquire before Twilio says who the
    // call is.
    if (this.hasEnded) return;
    await this.stt.connect();
    console.log(`[TelephonyStream] STT ready for session: ${this.sessionId}`);
  }

  /**
   * Confirms this call's slot lease (idempotent — the webhook already took
   * it) and renews it while the call runs. If this Function is killed
   * mid-call, renewals stop and the lease expires on its own, so the slot
   * comes back without anyone having to release it.
   */
  private async holdCallSlot(): Promise<void> {
    if (this.hasEnded || this.callSid === "unknown") return;
    const slot = await acquireCallSlot(this.callSid, this.clientId);
    console.info(JSON.stringify({ service: "telephony", event: "call_slot_held", callSid: this.callSid, acquired: slot.acquired, alreadyHeld: slot.alreadyHeld, active: slot.active, max: slot.max, degraded: slot.degraded ?? false }));
    if (this.hasEnded || this.slotRenewTimer) return;
    this.slotRenewTimer = setInterval(() => {
      void renewCallSlot(this.callSid).then((held) => {
        if (!held) console.warn(JSON.stringify({ service: "telephony", event: "call_slot_renew_failed", callSid: this.callSid }));
      });
    }, CALL_SLOT_RENEW_EVERY_MS);
    this.slotRenewTimer.unref?.();
  }

  /** Releases exactly this call's slot, once (Twilio's status callback may release it too — that's harmless). */
  private async releaseCallSlot(): Promise<void> {
    if (this.slotRenewTimer) {
      clearInterval(this.slotRenewTimer);
      this.slotRenewTimer = null;
    }
    if (this.slotReleaseStarted || this.callSid === "unknown") return;
    this.slotReleaseStarted = true;
    const released = await releaseSlotLease(this.callSid, "stream_closed");
    console.info(JSON.stringify({ service: "telephony", event: "call_slot_released", callSid: this.callSid, sessionId: this.sessionId, released }));
  }
  private async onInitFailed(err: unknown) {
    console.error(`[TelephonyStream] Initialisation failed for ${this.callSid}:`, err);
    this.hasEnded = true;

    try {
      this.stt.close();
    } catch {
      // may have failed before connecting
    }

    await this.releaseCallSlot();

    const endedAt = Date.now();

    await this.updateCallLog({
      status: "failed",
      endedAt,
      durationMs: endedAt - this.startedAt,
    });

    try {
      this.ws.close(1011, "stream initialisation failed");
    } catch {
      // socket may already be gone
    }
  }

  /**
   * Resolves the voice model/provider to use for the rest of this call.
   * Kicked off once (from the "start" event, as soon as agentId/clientId are
   * known) and NOT awaited there — by the time the first turn's first
   * clause is ready to speak, this has almost always already resolved, so
   * it doesn't add latency to the hot path the way a per-turn DB lookup
   * would (which is what the old buffered path paid on every single reply).
   */
  private async setupVoiceForCall(): Promise<void> {
    try {
      const [agentInfo, voiceSettings] = await Promise.all([
        this.agentId ? getAgentWithTenantCached(supabase, this.agentId).catch(() => null) : Promise.resolve(null),
        getClientVoiceSettings(this.clientId).catch(() => null),
        // The tenant's speech default is a two-query chain that
        // resolveSpeechConfig() would otherwise start only AFTER the two
        // lookups above finish — begin it now so it overlaps them.
        warmTenantSpeechDefault(this.clientId),
      ]);
      if (agentInfo?.voice_persona) {
        this.voiceModel = resolveVoiceModel(agentInfo.voice_persona);
      }
      this.greeting = agentInfo?.greeting ?? null;
      if (voiceSettings?.provider === "elevenlabs" && voiceSettings.voiceId) {
        // Tenant's custom cloned ElevenLabs voice takes priority over any
        // agent-level speech_provider choice (Deepgram/Gnani) — unchanged
        // from before this feature existed. Neither streaming path
        // (DeepgramSpeakStream nor GnaniSpeakStream) covers a cloned voice,
        // so this still needs the buffered synth-then-send path
        // (synthesizeLinear16, reached via the default Deepgram ttsEngine
        // below, already redirects to ElevenLabs internally via
        // getClientVoiceSettings).
        this.useBufferedTts = true;
      } else {
        const speechConfig = await resolveSpeechConfig(this.clientId, this.agentId, agentInfo);
        this.speechProvider = speechConfig.provider;
        this.language = speechConfig.language;

        if (this.speechProvider === "gnani") {
          // Agent's own voice_persona wins; falls back to the tenant's
          // business_settings.voice_persona (resolveSpeechConfig already
          // carried that through), then to DEFAULT_GNANI_VOICE.
          const gnaniVoice = parseGnaniPersona(agentInfo?.voice_persona ?? speechConfig.voicePersona);
          this.gnaniVoice = gnaniVoice.id;
          this.gnaniModel = gnaniVoice.model;
        }

        if (this.speechProvider !== "deepgram") {
          // Swap the eagerly-opened default (Deepgram) STT connection for
          // the resolved provider's — only non-Deepgram calls pay this one
          // reconnect, see the constructor's comment.
          this.stt.close();
          this.stt = createLiveStt(this.speechProvider, {
            sampleRate: 8000,
            language: this.language,
            onTranscript: this.onTranscript.bind(this),
          });
          await this.stt.connect();
        }

        // Both providers stream now (DeepgramSpeakStream / GnaniSpeakStream,
        // see ensureSpeakStream() below) — ttsEngine here is only the
        // buffered fallback used if the streaming connection itself fails
        // to open (see ensureSpeakStream()'s catch).
        this.ttsEngine = createTtsEngine(this.speechProvider, this.language, this.gnaniVoice, this.gnaniModel);
      }
    } catch (err) {
      console.warn(`[TelephonyStream] Voice setup failed for ${this.callSid}, using defaults:`, err);
    }
  }

  /**
   * Lazily creates and connects ONE Speak stream for the whole call, reused
   * across every turn. A fresh WebSocket handshake per turn (the original
   * design) cost ~50-150ms on every single reply; keeping one connection
   * alive for the call's lifetime pays that cost once — and per
   * setupVoiceForCall()'s caller, that "once" happens as soon as the
   * caller's voice/persona is resolved, in parallel with everything else,
   * so in practice it's usually already connected before the first turn
   * even needs it. Each turn rebinds the audio handler (setAudioHandler)
   * to its own generation-checked callback rather than opening a new
   * connection; barge-in calls clear() on it, never close() — see
   * onTwilioMessage's "media" case.
   */
  private desiredSpeakKey(): string {
    const voice = this.speechProvider === "gnani" ? this.gnaniVoice : this.voiceModel;
    return `${this.speechProvider}|${voice}|${this.language}|${this.gnaniModel}`;
  }

  private ensureSpeakStream(): { stream: SpeakStreamHandle; ready: Promise<void> } {
    const key = this.desiredSpeakKey();
    // A connection pre-opened with the default voice before the call's real
    // voice was known (prewarmSpeakStream) is replaced if they differ.
    if (this.currentSpeakStream && this.speakStreamKey !== key) {
      try {
        this.currentSpeakStream.close();
      } catch {
        // already gone
      }
      this.currentSpeakStream = null;
      this.speakStreamReadyPromise = null;
    }
    if (!this.currentSpeakStream) {
      const stream = createSpeakStream(
        this.speechProvider,
        {
          sampleRate: 8000,
          language: this.language,
          voice: this.speechProvider === "gnani" ? this.gnaniVoice : this.voiceModel,
          gnaniModel: this.gnaniModel,
        },
        () => { } // replaced per-turn via setAudioHandler before first use
      );
      this.currentSpeakStream = stream;
      this.speakStreamKey = key;
      this.speakStreamReadyPromise = stream.connect().catch((err) => {
        // A connection that was already swapped out (see above) failing late
        // must not tear down its replacement.
        if (this.currentSpeakStream !== stream) return;
        console.error(`[TelephonyStream] Speak stream connect failed for ${this.callSid}, falling back to buffered TTS:`, err);
        this.currentSpeakStream = null;
        this.speakStreamReadyPromise = null;
        // Without this, a failed streaming connect just silently no-ops on
        // every sendText()/flush() for the rest of the call (both
        // DeepgramSpeakStream and GnaniSpeakStream check `ws.readyState`
        // before sending) — the agent would go quiet instead of degrading.
        this.useBufferedTts = true;
      });
    }
    return { stream: this.currentSpeakStream, ready: this.speakStreamReadyPromise! };
  }

  /**
   * Opens the TTS connection the instant the call starts, with the default
   * voice, in parallel with the agent/tenant lookups that decide the real
   * one — instead of only after them. Those lookups are the long pole of
   * call setup, so the handshake (~100ms) used to be added on top of them
   * before the greeting could play. If the resolved voice differs,
   * ensureSpeakStream() swaps the connection out.
   */
  private prewarmSpeakStream(): void {
    if (!this.useBufferedTts) this.ensureSpeakStream();
  }

  /**
   * Speaks the agent's configured opening line (Agent Builder's `greeting`
   * field) the moment voice setup resolves, instead of the agent only ever
   * responding once the caller speaks first — kicked off from the "start"
   * handler below, right alongside the existing eager ensureSpeakStream()
   * call, so it shares the exact same resolved voice/provider a normal
   * reply this call would use.
   */
  private async speakGreeting(): Promise<void> {
    const text = this.greeting?.trim();
    if (!text || this.hasEnded) return;

    void announceGreeting({ sessionId: this.sessionId, userId: this.userId, clientId: this.clientId, text });

    const myGeneration = this.generation;
    if (this.useBufferedTts) {
      await this.speakBuffered(text);
      return;
    }

    const { stream: speakStream, ready: speakStreamReady } = this.ensureSpeakStream();
    speakStream.setAudioHandler((audioChunk) => {
      if (myGeneration !== this.generation) return; // barge-in happened mid-greeting
      this.sendAudioChunkToTwilio(audioChunk);
    });
    this.isSpeaking = true;
    try {
      await speakStreamReady;
      if (myGeneration !== this.generation) return;
      speakStream.sendText(text);
      speakStream.flush();
    } finally {
      if (myGeneration === this.generation) this.isSpeaking = false;
    }
  }

  private onTwilioMessage(raw: Buffer) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      case "connected":
        console.log(`[TelephonyStream] Stream connected for ${this.callSid}`);
        break;

      case "start": {
        const startData = msg.start as Record<string, unknown>;
        this.streamSid = startData?.streamSid as string;

        // Twilio's own callSid on the start event is authoritative — the
        // one passed at WS-upgrade time (query string) isn't reliably
        // forwarded on the Media Stream connection URL (verified live: it
        // arrived as "unknown" on a real call). customParameters is the
        // Twilio-documented way to receive clientId/agentId/caller, set via
        // <Parameter> in buildConnectTwiml — read those here instead of
        // trusting whatever this.* held from construction.
        if (startData?.callSid) this.callSid = startData.callSid as string;
        const customParams = startData?.customParameters as Record<string, string> | undefined;
        if (customParams?.clientId) this.clientId = customParams.clientId;
        if (customParams?.agentId) this.agentId = customParams.agentId;
        if (customParams?.patientId) this.patientId = customParams.patientId;
        // if (customParams?.caller) this.callerNumber = customParams.caller;
        if (customParams?.caller) {
          this.callerNumber = customParams.caller;
          this.userId = `caller-${customParams.caller.replace(/\D/g, "")}`;
        }

        console.log(`[TelephonyStream] Stream started: callSid=${this.callSid} clientId=${this.clientId}${this.agentId ? ` agentId=${this.agentId}` : ""} streamSid=${this.streamSid}`);

        // Only now do we know the real callSid — updating call_logs any
        // earlier (e.g. in init()) would target a row keyed by whatever
        // wrong/placeholder id we started with and silently match nothing.
        void this.updateCallLog({ sessionId: this.sessionId });
        void this.holdCallSlot();
        // Separate update: on a database without migration_v25's column it
        // fails alone instead of taking the sessionId with it.
        if (this.agentId) void this.recordAgent(this.agentId);

        // Only now do we know the real clientId/agentId either — kick off
        // voice setup here, not in init(), for the same reason. Chained to
        // also eagerly open the Speak WS connection the instant the right
        // voice model is known — by the time the caller actually finishes
        // their first utterance (at least a second or two of real time),
        // this has almost always already connected, so the ~50-150ms
        // handshake doesn't sit on the first turn's critical path either.
        this.prewarmSpeakStream();
        this.voiceSetupPromise = this.setupVoiceForCall().then(() => {
          if (!this.useBufferedTts) {
            this.ensureSpeakStream();
          } else if (this.currentSpeakStream) {
            // A custom (ElevenLabs) voice can't stream — drop the pre-opened connection.
            this.currentSpeakStream.close();
            this.currentSpeakStream = null;
            this.speakStreamReadyPromise = null;
          }
          void this.speakGreeting().catch((err) => console.error(`[TelephonyStream] speakGreeting failed for ${this.callSid}:`, err));
        });
        break;
      }

      case "media": {
        // Twilio sends base64-encoded mulaw audio chunks
        const media = msg.media as Record<string, unknown>;
        if (media?.payload) {
          const mulawBuf = Buffer.from(media.payload as string, "base64");
          const pcmBuf = decodeMulaw(mulawBuf);

          // Issue #14: Accumulate PCM for turn-level acoustic analysis
          this.turnAudioChunks.push(pcmBuf);
          this.callerSound.note(computeRmsEnergy(pcmBuf), 300);

          // Local VAD first (microseconds), STT second: lets a real
          // interruption be acted on without waiting for a transcript.
          this.vad.push(pcmBuf);
          this.onVadActivity();

          this.stt.sendAudio(pcmBuf);
        }
        break;
      }

      case "mark": {
        // Twilio echoes each mark once the audio sent before it has played
        // (and all remaining ones at once after a "clear").
        const name = (msg.mark as Record<string, unknown> | undefined)?.name;
        if (typeof name === "string") this.pendingMarks.delete(name);
        break;
      }

      case "stop":
        console.log(`[TelephonyStream] Stream stop event for ${this.callSid}`);
        this.onCallEnded();
        break;
    }
  }

  /**
   * Whether the caller can currently hear the agent: a reply is still being
   * generated, or audio already sent to Twilio hasn't finished playing.
   * `isSpeaking` alone went false as soon as the reply text was finished —
   * while several seconds of it were still playing — so talking over the
   * agent then wasn't treated as an interruption at all: the agent kept
   * talking, then answered as well (the "double reply").
   */
  private isAgentAudible(): boolean {
    return this.isSpeaking || this.pendingMarks.size > 0;
  }

  /**
   * Whether `text`, heard while the agent is audible, is a real interruption.
   * Not one: listening sounds ("hmm", "haan ji"), 1-2 letter noise fragments,
   * and — once the VAD has learned the caller's own voice level — any words
   * with no near-field caller speech behind them (a background talker, or the
   * STT hallucinating words out of noise).
   */
  private bargeInVerdict(text: string): "barge" | "ignore" {
    if (isBackchannel(text) || isNoiseFragment(text)) return "ignore";
    if (this.vad.isCalibrated() && this.vad.recentSpeechMs(1000) < CONFIG.vad.minSpeechForBargeInMs) {
      console.info(JSON.stringify({ service: "telephony", event: "barge_in_ignored_background", callSid: this.callSid, characterCount: text.length }));
      return "ignore";
    }
    return "barge";
  }

  /** True when the VAD knows the caller's voice level and this turn held less of it than a real utterance. */
  private isBackgroundOnly(): boolean {
    return this.vad.isCalibrated() && this.vad.turnSpeechMs < CONFIG.vad.minSpeechForTurnMs;
  }

  /**
   * Runs on every inbound 20ms frame. Energy-only barge-in: sustained,
   * near-field caller speech while the agent is audible stops the agent now,
   * without waiting ~300-600ms for the first transcript words. Deliberately
   * conservative so it can't be the false-positive source the transcript-only
   * design was originally chosen to avoid: it needs a learned caller level
   * (never fires on the greeting or on speakerphone echo of the agent), speech
   * well past the length of any "mm-hm", and defers to the transcript path as
   * soon as any text exists (which knows whether it was just a filler).
   */
  private onVadActivity(): void {
    const run = this.vad.speechRunMs;
    if (run === 0) this.lastInterimWhileAudible = "";
    // The caller has started talking, so a reply is about to be needed:
    // refresh the LLM connection now rather than when the sentence ends.
    if (run >= 100) prewarmLlm();
    if (!CONFIG.vad.energyBargeIn || !this.vad.isCalibrated() || !this.isAgentAudible()) return;
    if (run < CONFIG.vad.bargeInSustainedMs || this.lastInterimWhileAudible) return;
    this.triggerBargeIn("sustained caller speech (VAD)");
  }

  private async onTranscript(text: string, isFinal: boolean) {
    if (!text.trim()) return;
    if (this.isAgentAudible()) {
      // "yeah", "okay", "hmm" while the agent talks is listening, not an
      // interruption. Anything else stops the agent (interim results arrive
      // while the caller is still mid-word, so this is quick) and the
      // caller's sentence becomes the next turn.
      this.lastInterimWhileAudible = text;
      if (this.bargeInVerdict(text) !== "barge") return;
      this.triggerBargeIn(isFinal ? "caller spoke" : "caller speech started");
    }
    if (!isFinal) return;
    // A turn that is only "um"/"hmm", or that the local VAD says no one near
    // the phone actually spoke (TV, a second person across the room), has
    // nothing to answer — dropping it here is what keeps the agent from
    // replying to background noise.
    if (isHesitationOnly(text)) {
      this.vad.resetTurn();
      return;
    }
    if (this.isBackgroundOnly()) {
      console.info(JSON.stringify({ service: "telephony", event: "background_turn_ignored", callSid: this.callSid, characterCount: text.length, turnSpeechMs: this.vad.turnSpeechMs }));
      this.vad.resetTurn();
      return;
    }
    // BUG-E7: when the merge branch below fires, the caller's two
    // transcript fragments get concatenated into one `text`, but the pause
    // between them (the agent still composing its reply) is commonly well
    // past isolateLastUtterance's default utterance-boundary cutoff — which
    // would then (wrongly, since we KNOW structurally this is one
    // utterance) drop the earlier fragment's audio while wordCount below
    // still counts both fragments' words. Tracked here so the turnPcm
    // isolation a few lines down can opt into "span from first speech"
    // mode specifically for this case.
    let wasMerged = false;
    if (this.isBusy) {
      // Once the agent is talking, an interruption goes through barge-in
      // (triggerBargeIn frees the turn before this transcript arrives).
      if (this.isSpeaking || !this.currentTurnText) return;
      // The caller kept talking after a pause while the agent was still
      // preparing its reply, so that turn was only half a sentence ("I'm
      // really worried that something" … "went wrong in the surgery"). This
      // used to be dropped outright, losing the end of the sentence and
      // answering the fragment. Cancel the half-built reply and answer the
      // whole sentence instead.
      const merged = `${this.currentTurnText} ${text.trim()}`;
      console.info(JSON.stringify({ service: "telephony", event: "caller_turn_merged", timestamp: new Date().toISOString(), callSid: this.callSid, streamSid: this.streamSid, clientId: this.clientId, agentId: this.agentId ?? null, patientId: this.patientId ?? null, sessionId: this.sessionId }));
      this.generation++;
      this.currentAbortController?.abort();
      text = merged;
      wasMerged = true;
    }
    this.isBusy = true;
    this.currentTurnText = text;
    const myGeneration = this.generation;
    const marks = new TurnMarks(Date.now(), this.callerSound.at);

    console.info(JSON.stringify({ service: "telephony", event: "transcript_received", timestamp: new Date().toISOString(), callSid: this.callSid, streamSid: this.streamSid, clientId: this.clientId, agentId: this.agentId ?? null, patientId: this.patientId ?? null, sessionId: this.sessionId, final: isFinal, characterCount: text.length }));

    const abortController = new AbortController();
    this.currentAbortController = abortController;
    // Ground truth for "what did the caller actually hear before a
    // barge-in cut this turn off" — only clauses that passed the
    // generation check (i.e. genuinely got forwarded to Twilio) are
    // pushed here. Deliberately NOT the same as orchestrator's own
    // internal `spokenSoFar` bookkeeping, which has no concept of
    // "generation" and would also include a same-turn recovery-apology
    // clause (llm.ts's "Sorry, I lost my train of thought...") that a
    // true barge-in already silently drops before it ever reaches the
    // phone line — recording that text as if it were heard would corrupt
    // memory with something that was never actually spoken.
    const trulySpokenClauses: string[] = [];

    try {
      // Issue #14: Extract acoustic features from accumulated PCM
      // Only the caller's own latest utterance — not the silence while the
      // agent spoke or the line waited (see isolateLastUtterance). On a
      // merged turn, span from the very first speech instead of applying
      // the normal utterance-gap cutoff — see BUG-E7 note above.
      const turnPcm = isolateLastUtterance(Buffer.concat(this.turnAudioChunks), { fromFirstSpeech: wasMerged });
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const acousticFeatures = turnPcm.length > 0
        ? extractAcousticFeatures(turnPcm, wordCount)
        : undefined;

      if (this.voiceSetupPromise) await this.voiceSetupPromise;

      // One language per utterance: "yes आई एम हार्दिक" (English split across scripts) becomes "yes I am Hardik".
      const spoken = await normalizeTranscript(text, { clientId: this.clientId });
      const requested = detectLanguageRequest(text);
      if (requested) this.languageLock = requested;

      const turnInput = {
        sessionId: this.sessionId,
        userId: this.userId,
        clientId: this.clientId,
        agentId: this.agentId,
        patientId: this.patientId,
        callerNumber: this.callerNumber,
        transcript: spoken,
        language: this.language,
        languageLock: this.languageLock ?? undefined,
        sttConfidence: 0.9,
        audioEmotion: null,
        acousticFeatures,
        // The same utterance for the trained voice-emotion model, which runs
        // in the deferred diagnostics pass (never delays the reply).
        rawAudioPcm16k: turnPcm.length > 0 ? upsample8kTo16kFloat32(turnPcm) : undefined,
        bargeInCount: this.turnInterruptionCount,
        // Powers the Live Dashboard's per-engine breakdown for real calls —
        // safe to enable here specifically because deferDiagnostics (below)
        // means it can never delay this function returning, so it can never
        // gate this.isBusy / when the system accepts the caller's next
        // sentence, no matter how long the (capped, ~500ms-1.5s) diagnostics
        // computation takes.
        diagnostics: true,
      };

      if (this.useBufferedTts) {
        // Tenant has a custom ElevenLabs voice — no streaming Speak WS
        // support for that path yet, use the original buffered flow.
        const output = await handleTurn(turnInput, { deferDiagnostics: true });
        if (myGeneration === this.generation) {
          console.log(`[TelephonyStream] Reply (${this.callSid}): "${output.reply}"`);
          await this.speakBuffered(
            output.reply,
            output.trace.emotion.current.label,
            output.trace.agent?.voicePersona ?? undefined,
            output.trace.policy,
            text
          );
        }
        return;
      }

      // Kicked off now (not lazily inside onReplyChunk) — reuses the
      // call-lifetime connection if a prior turn already opened one, or
      // starts connecting immediately, in parallel with the LLM call below,
      // instead of only starting once the first clause is ready. Rebound to
      // this turn's own generation-checked handler right away.
      const { stream: speakStream, ready: speakStreamReady } = this.ensureSpeakStream();
      speakStream.setAudioHandler((audioChunk) => {
        if (myGeneration !== this.generation) return; // stale — barge-in happened
        const first = marks.firstAudio();
        if (first) {
          console.log(`[Latency] ${this.callSid}: listen ${first.listenMs}ms · think ${first.thinkMs ?? "-"}ms · voice ${first.voiceMs ?? "-"}ms · FIRST WORD ${first.firstWordMs}ms`);
          void emitSessionEvent(this.sessionId, "latency", first as unknown as Record<string, unknown>);
        }
        this.sendAudioChunkToTwilio(audioChunk);
      });

      // Resolved via onEmotionResolved below, well before the first clause
      // arrives (policy/emotion are computed before the LLM call even
      // starts) — lets each streamed clause get the same adaptive-tone
      // pause shaping (BUG-V1) the buffered path applies to the whole
      // reply at once, instead of losing that feature on the path that's
      // now actually used for real calls.
      let prosodyParams: TTSProsodyParams | null = null;

      const output = await handleTurn(turnInput, {
        abortSignal: abortController.signal,
        deferDiagnostics: true,
        onEmotionResolved: (emotion, policy) => {
          prosodyParams = getEmotionTTSParams(emotion, policy, text);
        },
        onReplyChunk: (clause) => {
          if (myGeneration !== this.generation) return; // stale — dropped by barge-in
          trulySpokenClauses.push(clause);
          this.isSpeaking = true;
          marks.firstClause();
          const shaped = prosodyParams ? applyEmotionProsody(clause, prosodyParams, this.speechProvider) : clause;
          void speakStreamReady.then(() => {
            if (myGeneration !== this.generation) return;
            marks.ttsSend();
            speakStream.sendText(shaped);
            speakStream.flush();
          });
        },
      });

      console.log(`[TelephonyStream] Reply (${this.callSid}): "${output.reply}"`);

      // Deliberately NOT closed here — see ensureSpeakStream()'s doc
      // comment. It stays open for the next turn and is only closed in
      // onCallEnded(). Also deliberately NOT calling speakBuffered() here —
      // unlike the pre-streaming version, every clause's audio (already
      // prosody-shaped — see onReplyChunk above) was sent as it was
      // generated; synthesizing the whole reply again here would just
      // speak it a second time.
      if (myGeneration === this.generation) {
        this.isSpeaking = false;
      }
    } catch (err) {
      if (myGeneration !== this.generation) {
        console.log(`[TelephonyStream] Turn cancelled by barge-in for ${this.callSid}.`);
        const partial = trulySpokenClauses.join(" ");
        if (partial) {
          console.log(`[TelephonyStream] Recording interrupted partial reply for ${this.callSid}: "${partial}"`);
          void recordInterruptedReply({
            sessionId: this.sessionId,
            userId: this.userId,
            clientId: this.clientId,
            partialText: partial,
          });
        }
      } else {
        console.error(`[TelephonyStream] handleTurn error:`, err);
      }
    } finally {
      // A superseded turn (barge-in, or merged into a longer sentence above)
      // must not reset state the turn that replaced it is now using.
      if (myGeneration === this.generation) {
        this.isBusy = false;
        this.currentTurnText = "";
        this.currentAbortController = null;
        // Reset turn-level accumulators for next utterance
        this.turnAudioChunks = [];
        this.turnInterruptionCount = 0;
        this.vad.resetTurn();
      }
    }
  }

  /**
   * Splits one Deepgram Speak audio chunk into Twilio-sized (~20ms) mulaw
   * frames and sends each as its own `media` message, as soon as it's
   * available — this, plus DeepgramSpeakStream's streaming synthesis, is
   * what actually produces "starts speaking while still generating" instead
   * of the old buffered "wait for 100% of the audio, send one giant blob".
   */
  private sendAudioChunkToTwilio(pcmChunk: Buffer): void {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;
    const mulaw = pcmToMulaw(pcmChunk);
    for (let offset = 0; offset < mulaw.length; offset += TWILIO_FRAME_BYTES) {
      const frame = mulaw.subarray(offset, Math.min(offset + TWILIO_FRAME_BYTES, mulaw.length));
      const mediaMessage = JSON.stringify({
        event: "media",
        streamSid: this.streamSid,
        media: { payload: frame.toString("base64") },
      });
      this.ws.send(mediaMessage);
    }
    this.sendPlaybackMark();
  }

  /** Asks Twilio to tell us when the audio sent so far has played (see the "mark" case). */
  private sendPlaybackMark(): void {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;
    const name = `reply-${++this.markSeq}`;
    this.pendingMarks.add(name);
    this.ws.send(JSON.stringify({ event: "mark", streamSid: this.streamSid, mark: { name } }));
  }

  /**
   * Buffered synth-then-send path — converts text → Linear16 PCM → G.711
   * μ-law → sends the whole thing to Twilio in one go. Kept for the filler
   * phrase (a short fixed string, not worth streaming) and as the fallback
   * for tenants with a custom ElevenLabs voice (see setupVoiceForCall()).
   * `policy`/`callerText` drive the adaptive tone (BUG-V1) — real calls
   * previously never passed policy to TTS at all.
   */
  private async speakBuffered(text: string, emotionLabel?: EmotionLabel, persona?: string, policy?: PolicyDirectives, callerText?: string) {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      // Get raw 8kHz Linear16 PCM directly from Deepgram (or the tenant's
      // custom ElevenLabs voice, if configured) — already in the exact
      // format pcmToMulaw expects, no decoding required. `persona` is the
      // Agent Builder agent's own chosen Deepgram voice (voice_persona),
      // when this call is routed through a custom agent — takes priority
      // over the CONFIG default but is still overridden by a tenant-level
      // ElevenLabs voice inside synthesizeLinear16() if one is configured.
      const pcmBytes = await this.ttsEngine.synthesizeLinear16(text, { clientId: this.clientId, emotion: emotionLabel, persona, policy, callerText });
      const mulawAudio = pcmToMulaw(pcmBytes);
      const base64Audio = mulawAudio.toString("base64");

      const mediaMessage = JSON.stringify({
        event: "media",
        streamSid: this.streamSid,
        media: {
          payload: base64Audio,
        },
      });

      this.ws.send(mediaMessage);
      // Playback is tracked by the mark from here on (isAgentAudible).
      this.sendPlaybackMark();
    } catch (err) {
      console.error(`[TelephonyStream] TTS error:`, err);
      this.isSpeaking = false;
    }
  }

  /**
   * Stops the agent because the caller started talking over it (see
   * onTranscript): clears queued audio on Twilio and Deepgram, cancels the
   * in-flight reply, and frees the line for the caller's sentence.
   */
  private triggerBargeIn(reason: string) {
    this.isSpeaking = false;
    this.turnInterruptionCount++;
    this.lastInterimWhileAudible = "";

    // Order matters — everything below is synchronous, but each step is what
    // the caller perceives first:
    //  1. Twilio `clear`: the audio the caller is HEARING stops. This is the
    //     only step they can notice, so it goes out first.
    //  2. generation++: from this instant any audio chunk or clause from the
    //     interrupted turn is dropped on arrival instead of being forwarded.
    //  3. Speak stream clear(): stop synthesizing speech nobody will hear.
    //     clear() only — NOT close(): the connection is kept alive for the
    //     whole call (see ensureSpeakStream()) so the next turn doesn't pay
    //     another ~50-150ms handshake.
    //  4. Abort the LLM and flush its pending output: only now, last, since
    //     it is invisible to the caller. The caller's actual interruption
    //     (still being transcribed in the background — never gated) is then
    //     processed as a fresh turn instead of being dropped by isBusy.
    this.sendClearMessage();
    this.generation++;
    this.currentSpeakStream?.clear();
    this.currentAbortController?.abort();
    this.isBusy = false;
    this.currentTurnText = "";

    console.log(`[TelephonyStream] Barge-in triggered (${reason}) for ${this.callSid}`);
  }

  /**
   * Issue #8: Send a clear message to Twilio to stop any in-progress audio playback (barge-in).
   */
  private sendClearMessage() {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;
    const clearMsg = JSON.stringify({
      event: "clear",
      streamSid: this.streamSid,
    });
    this.ws.send(clearMsg);
    // Twilio drops the queued audio and echoes the remaining marks; nothing
    // is playing any more either way.
    this.pendingMarks.clear();
    console.log(`[TelephonyStream] Barge-in: cleared TTS playback for ${this.callSid}`);
  }

  private async onCallEnded() {
    if (this.hasEnded) return;
    this.hasEnded = true;

    const endedAt = Date.now();
    const durationMs = endedAt - this.startedAt;

    console.log(`[TelephonyStream] Call ended: ${this.callSid}, duration: ${durationMs}ms`);

    await this.releaseCallSlot();
    this.stt.close();
    this.currentSpeakStream?.close();

    await this.updateCallLog({
      status: "completed",
      endedAt,
      durationMs,
    });

    // Post-Call SMS Recovery Trigger (Issue #16)
    try {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("id")
        .eq("auth_user_id", this.clientId)
        .single();

      if (tenant) {
        const { data: settings } = await supabase
          .from("business_settings")
          .select("sms_recovery_enabled, sms_recovery_template, sms_recovery_link")
          .eq("tenant_id", tenant.id)
          .single();

        if (settings?.sms_recovery_enabled && this.callerNumber && this.callerNumber !== "unknown") {
          const utterances = await stm.get(this.sessionId);
          const userUtterances = utterances.filter((u) => u.role === "user");
          const lastUserUtterance = userUtterances[userUtterances.length - 1];
          const lastEmotion = lastUserUtterance?.emotion?.label || "neutral";

          const NEGATIVE_EMOTIONS = new Set(["anger", "frustration", "sadness", "distress", "disappointment", "pain"]);

          if (NEGATIVE_EMOTIONS.has(lastEmotion)) {
            console.log(`[TelephonyStream] Call ended with negative emotion "${lastEmotion}". Triggering recovery SMS to ${this.callerNumber}`);

            const template = settings.sms_recovery_template || "We noticed you had a bad experience. Use {{link}} to get in touch.";
            const link = settings.sms_recovery_link || "";
            const body = template.replace("{{link}}", link);

            await sendSMS({
              to: this.callerNumber,
              body,
            });
          }
        }
      }
    } catch (err) {
      console.error("[TelephonyStream] Error checking/triggering recovery SMS:", err);
    }
  }

  /** Which agent handled this call (call_logs."agentId", migration_v25) — used to group post-call findings per agent. */
  private async recordAgent(agentId: string) {
    const { error } = await supabase.from("call_logs").update({ agentId }).eq("id", this.callSid);
    if (error && !isMissingColumnError(error)) console.error(`[TelephonyStream] Failed to record agent on call_logs:`, error);
  }

  private async updateCallLog(updates: Record<string, unknown>) {
    const { error } = await supabase
      .from("call_logs")
      .update(updates)
      .eq("id", this.callSid);

    if (error) {
      console.error(`[TelephonyStream] Failed to update call_logs:`, error);
    }
  }
}
