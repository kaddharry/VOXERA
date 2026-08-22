import { nanoid } from "nanoid";
import WebSocket from "ws";
import { DeepgramLiveWrapper } from "../deepgram/live";
import { synthesizeLinear16, resolveVoiceModel, getClientVoiceSettings } from "../deepgram/tts";
import { DeepgramSpeakStream } from "../deepgram/tts-stream";
import { handleTurn, recordInterruptedReply } from "../agent/orchestrator";
import { applyEmotionProsody, getEmotionTTSParams, type TTSProsodyParams } from "../emotion/tts-params";
import type { EmotionLabel, PolicyDirectives } from "../types";
import { supabase } from "../db/supabase";
import { getAgentWithTenant } from "../db/agents";
import { callQueue } from "../queue/manager";
import { stm } from "../memory/stm";
import { sendSMS } from "./sms";
import { CONFIG } from "../config";
import { computeRmsEnergy, computeFrameZeroCrossingRate, extractAcousticFeatures } from "../audio/acoustic";

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
  for (let expMask = 0x4000; (pcmSample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
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

/**
 * TelephonyStreamHandler manages the full real-time audio loop for one phone call.
 *
 * Lifecycle:
 *  1. Twilio opens a WebSocket (Media Stream) → this handler receives audio frames
 *  2. Audio is decoded mulaw → PCM → streamed to Deepgram STT
 *  3. On final transcript → handleTurn() (orchestrator), streaming clause-by-clause
 *  4. Each clause → Deepgram's streaming Speak WebSocket → μ-law → sent to Twilio
 *     as soon as it's ready, not buffered until the whole reply is done
 *  5. Call ends → DB updated, queue updated
 *
 * Latency-overhaul notes (see /Users/vikasverma/.claude/plans/structured-zooming-quiche.md):
 *  - TTS is streamed (DeepgramSpeakStream, lib/deepgram/tts-stream.ts) so the
 *    caller starts hearing clause 1 while the LLM is still generating later
 *    clauses, instead of waiting for the entire reply to finish synthesizing.
 *  - Barge-in uses the generation-counter pattern already proven in
 *    server.ts (the browser demo path): bumping `generation` invalidates
 *    whatever's in flight, so a stale turn's audio/clauses are dropped
 *    instead of racing with the caller's actual interruption.
 *  - On barge-in: cancels the in-flight LLM call (AbortController) and
 *    clears/closes the in-flight Speak stream, instead of only stopping
 *    Twilio playback of audio already sent.
 *  - A tenant's custom ElevenLabs voice (no streaming Speak WS support yet)
 *    falls back to the original buffered synth-then-send path for that call
 *    only — see setupVoiceForCall().
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
  private deepgram: DeepgramLiveWrapper;
  private streamSid: string | null = null;
  private startedAt: number;
  private isBusy = false; // prevent overlapping LLM turns
  private isSpeaking = false; // Issue #8: track if TTS is playing for barge-in
  private hasEnded = false; // prevent double-invocation of onCallEnded
  private slotTaken = false;

  // Issue #14: PCM accumulator for acoustic feature extraction
  private turnAudioChunks: Buffer[] = [];
  // Issue #14: Barge-in interruption counter (per turn, reset on each transcript)
  private turnInterruptionCount = 0;
  // Consecutive Twilio media frames (20ms each) whose RMS has exceeded
  // CONFIG.telephony.bargeInEnergyThreshold. A single loud frame — a click,
  // a cough, a burst of line static — used to be enough to trigger a full
  // barge-in (cutting the agent off and cancelling its reply) on its own;
  // requiring BARGE_IN_SUSTAIN_FRAMES consecutive high-energy frames means
  // only genuinely sustained sound (real speech starting) fires it, while
  // still reacting within BARGE_IN_SUSTAIN_FRAMES * 20ms — imperceptibly
  // fast for a real interruption. Deepgram's own VAD signal (constructor's
  // onSpeechStarted) is unaffected by this and still fires independently as
  // the primary, model-based trigger — this only tightens the raw-energy
  // fallback that catches what VAD might miss.
  private consecutiveHighEnergyFrames = 0;

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
  private currentSpeakStream: DeepgramSpeakStream | null = null;
  private speakStreamReadyPromise: Promise<void> | null = null;

  // Resolved once per call (not per turn) in setupVoiceForCall() — an
  // agent's voice and a tenant's custom-voice provider don't change
  // mid-call, so there's no reason to re-resolve either on every reply.
  private voiceModel: string = CONFIG.deepgram.ttsModel;
  private useBufferedTts = false;
  private voiceSetupPromise: Promise<void> | null = null;

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

    this.deepgram = new DeepgramLiveWrapper(this.onTranscript.bind(this), {
      sampleRate: 8000,
      // Deepgram's own VAD onset signal, fired independently of the raw RMS
      // check below — a raw energy threshold alone can false-trigger on
      // background noise or miss quiet speech; this fires the same barge-in
      // path but off Deepgram's own speech-detection instead.
      onSpeechStarted: () => {
        if (this.isSpeaking) this.triggerBargeIn("deepgram-vad");
      },
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
    this.ws.on("close", () => this.onCallEnded());
    this.ws.on("error", (err) => {
      console.error(`[TelephonyStream] WebSocket error on ${this.callSid}:`, err);
      this.onCallEnded();
    });

    this.init().catch((err) => this.onInitFailed(err));
  }

  private async init() {
    await callQueue.markCallStarted();
    this.slotTaken = true;
    await this.deepgram.connect();
    console.log(`[TelephonyStream] Deepgram ready for session: ${this.sessionId}`);
  }
  private async onInitFailed(err: unknown) {
  console.error(`[TelephonyStream] Initialisation failed for ${this.callSid}:`, err);
  this.hasEnded = true;

  try {
    this.deepgram.close();
  } catch {
    // may have failed before connecting
  }

  if (this.slotTaken) {
    await callQueue.markCallEnded();
  }

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
        this.agentId ? getAgentWithTenant(supabase, this.agentId).catch(() => null) : Promise.resolve(null),
        getClientVoiceSettings(this.clientId).catch(() => null),
      ]);
      if (agentInfo?.voice_persona) {
        this.voiceModel = resolveVoiceModel(agentInfo.voice_persona);
      }
      if (voiceSettings?.provider === "elevenlabs" && voiceSettings.voiceId) {
        // Deepgram's streaming Speak WS doesn't cover a tenant's custom
        // cloned ElevenLabs voice — fall back to the original buffered
        // synth-then-send path for this call only, so the customization
        // keeps working correctly (streaming ElevenLabs is good follow-up
        // work, not core to this latency fix).
        this.useBufferedTts = true;
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
  private ensureSpeakStream(): { stream: DeepgramSpeakStream; ready: Promise<void> } {
    if (!this.currentSpeakStream) {
      const stream = new DeepgramSpeakStream(
        { model: this.voiceModel, encoding: "linear16", sampleRate: 8000 },
        () => {} // replaced per-turn via setAudioHandler before first use
      );
      this.currentSpeakStream = stream;
      this.speakStreamReadyPromise = stream.connect().catch((err) => {
        console.error(`[TelephonyStream] Speak stream connect failed for ${this.callSid}:`, err);
        this.currentSpeakStream = null;
        this.speakStreamReadyPromise = null;
      });
    }
    return { stream: this.currentSpeakStream, ready: this.speakStreamReadyPromise! };
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
        if (customParams?.caller) this.callerNumber = customParams.caller;

        console.log(`[TelephonyStream] Stream started: callSid=${this.callSid} clientId=${this.clientId}${this.agentId ? ` agentId=${this.agentId}` : ""} streamSid=${this.streamSid}`);

        // Only now do we know the real callSid — updating call_logs any
        // earlier (e.g. in init()) would target a row keyed by whatever
        // wrong/placeholder id we started with and silently match nothing.
        void this.updateCallLog({ sessionId: this.sessionId });

        // Only now do we know the real clientId/agentId either — kick off
        // voice setup here, not in init(), for the same reason. Chained to
        // also eagerly open the Speak WS connection the instant the right
        // voice model is known — by the time the caller actually finishes
        // their first utterance (at least a second or two of real time),
        // this has almost always already connected, so the ~50-150ms
        // handshake doesn't sit on the first turn's critical path either.
        this.voiceSetupPromise = this.setupVoiceForCall().then(() => {
          if (!this.useBufferedTts) this.ensureSpeakStream();
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

          // Issue #14: Energy-based barge-in detection, now paired with
          // Deepgram's own VAD SpeechStarted signal (see constructor) —
          // whichever fires first wins. RMS alone is a blunt instrument:
          // background noise can false-trigger it, quiet speech can miss it.
          if (this.isSpeaking) {
            const rms = computeRmsEnergy(pcmBuf);
            // Loud AND speech-shaped, not loud alone — a steady background
            // hum or a burst of line static can be just as loud as real
            // speech but sits at a ZCR extreme (near-0 for a hum, near-1 for
            // broadband hiss); genuine speech's ZCR lands in between. This
            // is what makes the raw-energy fallback "sensitive to the
            // caller's voice, not background noise" instead of triggering
            // on any sufficiently loud sound.
            const zcr = rms > CONFIG.telephony.bargeInEnergyThreshold ? computeFrameZeroCrossingRate(pcmBuf) : 0;
            const isSpeechShaped = zcr >= CONFIG.telephony.bargeInMinZcr && zcr <= CONFIG.telephony.bargeInMaxZcr;
            if (rms > CONFIG.telephony.bargeInEnergyThreshold && isSpeechShaped) {
              this.consecutiveHighEnergyFrames++;
              if (this.consecutiveHighEnergyFrames >= CONFIG.telephony.bargeInSustainFrames) {
                this.triggerBargeIn(`rms=${rms.toFixed(0)} zcr=${zcr.toFixed(2)} sustained=${this.consecutiveHighEnergyFrames}`);
              }
            } else {
              this.consecutiveHighEnergyFrames = 0;
            }
          } else {
            this.consecutiveHighEnergyFrames = 0;
          }

          this.deepgram.sendAudio(pcmBuf);
        }
        break;
      }

      case "stop":
        console.log(`[TelephonyStream] Stream stop event for ${this.callSid}`);
        this.onCallEnded();
        break;
    }
  }

  private async onTranscript(text: string, isFinal: boolean) {
    if (!isFinal || !text.trim() || this.isBusy) return;
    this.isBusy = true;
    const myGeneration = this.generation;

    console.log(`[TelephonyStream] Transcript (${this.callSid}): "${text}"`);

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
      const turnPcm = Buffer.concat(this.turnAudioChunks);
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const acousticFeatures = turnPcm.length > 0
        ? extractAcousticFeatures(turnPcm, wordCount)
        : undefined;

      if (this.voiceSetupPromise) await this.voiceSetupPromise;

      const turnInput = {
        sessionId: this.sessionId,
        userId: this.userId,
        clientId: this.clientId,
        agentId: this.agentId,
        patientId: this.patientId,
        transcript: text,
        sttConfidence: 0.9,
        audioEmotion: null,
        acousticFeatures,
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
          const shaped = prosodyParams ? applyEmotionProsody(clause, prosodyParams) : clause;
          void speakStreamReady.then(() => {
            if (myGeneration !== this.generation) return;
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
      this.isBusy = false;
      this.currentAbortController = null;
      // Reset turn-level accumulators for next utterance
      this.turnAudioChunks = [];
      this.turnInterruptionCount = 0;
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
      const pcmBytes = await synthesizeLinear16(text, { clientId: this.clientId, emotion: emotionLabel, persona, policy, callerText });
      const mulawAudio = pcmToMulaw(pcmBytes);
      const base64Audio = mulawAudio.toString("base64");

      this.isSpeaking = true;
      const mediaMessage = JSON.stringify({
        event: "media",
        streamSid: this.streamSid,
        media: {
          payload: base64Audio,
        },
      });

      this.ws.send(mediaMessage);
    } catch (err) {
      console.error(`[TelephonyStream] TTS error:`, err);
      this.isSpeaking = false;
    }
  }

  /**
   * Shared barge-in trigger, invoked by whichever signal fires first — the
   * RMS energy threshold or Deepgram's own VAD SpeechStarted event. Caller
   * is responsible for checking `this.isSpeaking` first (both call sites do).
   */
  private triggerBargeIn(reason: string) {
    this.isSpeaking = false;
    this.consecutiveHighEnergyFrames = 0;
    this.turnInterruptionCount++;
    this.sendClearMessage();

    // Invalidate the in-flight turn: cancel LLM generation, stop generating
    // audio nobody will hear, and let the caller's actual interruption
    // (still being transcribed by Deepgram in the background — never gated)
    // be processed as a fresh turn instead of being silently dropped by
    // isBusy below.
    this.generation++;
    this.currentAbortController?.abort();
    // clear() only — NOT close(). The Speak connection is kept alive for the
    // whole call (see ensureSpeakStream()) so the next turn doesn't pay
    // another ~50-150ms WS handshake; clear() just discards whatever audio
    // was queued/in-flight for the turn that just got interrupted.
    this.currentSpeakStream?.clear();
    this.isBusy = false;

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
    console.log(`[TelephonyStream] Barge-in: cleared TTS playback for ${this.callSid}`);
  }

  private async onCallEnded() {
    if (this.hasEnded) return;
    this.hasEnded = true;

    const endedAt = Date.now();
    const durationMs = endedAt - this.startedAt;

    console.log(`[TelephonyStream] Call ended: ${this.callSid}, duration: ${durationMs}ms`);

    await callQueue.markCallEnded();
    this.deepgram.close();
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

          const NEGATIVE_EMOTIONS = new Set(["anger", "frustration", "sadness", "distress", "disappointment"]);

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
