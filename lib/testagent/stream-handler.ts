import type { WebSocket } from "ws";
import { nanoid } from "nanoid";
import { announceGreeting, handleTurn } from "../agent/orchestrator";
import { synthesize, resolveVoiceModel, getClientVoiceSettings } from "../deepgram/tts";
import { applyEmotionProsody, getEmotionTTSParams, type TTSProsodyParams } from "../emotion/tts-params";
import { getAgentWithTenant } from "../db/agents";
import { supabase } from "../db/supabase";
import { createLiveStt, createSpeakStream } from "../speech/factory";
import { resolveSpeechConfig } from "../speech/resolve";
import { parseGnaniPersona } from "../tts/gnani-voices";
import type { LiveSttConnection, SpeakStreamHandle, SpeechProvider } from "../speech/types";
import { extractAcousticFeatures, computeRmsEnergy, isolateLastUtterance } from "../audio/acoustic";
import { int16ToFloat32Pcm } from "../emotion/local-audio-detect";
import { DEMO, ensureSeeded } from "../bootstrap";
import { CONFIG } from "../config";

// Sample rate for browser TTS playback. Not constrained by Twilio's 8kHz
// requirement (unlike lib/telephony/stream-handler.ts) — the browser's Web
// Audio API resamples an AudioBuffer at any declared rate transparently, so
// this is just "what quality does Deepgram render at," picked for clarity
// over telephony-grade compression.
const BROWSER_TTS_SAMPLE_RATE = 24000;

/**
 * The browser mic streams 16kHz linear16 PCM, but lib/audio/acoustic.ts's
 * feature extraction (pitch lag range, frame sizes) is tuned for Twilio's
 * 8kHz telephony audio — the same DSP real calls use. Downsample 2:1 rather
 * than re-parametrizing that module, so the acoustic engine itself stays
 * exactly what real calls exercise (and keeps its existing test suite valid).
 */
function downsample16kTo8k(pcm: Buffer): Buffer {
  const inSamples = Math.floor(pcm.length / 2);
  const outSamples = Math.floor(inSamples / 2);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    out.writeInt16LE(pcm.readInt16LE(i * 4), i * 2);
  }
  return out;
}

export interface TestAgentStreamHandlerOptions {
  ws: WebSocket;
  /** Optional Agent Builder agent id — lets the live test drawer test
   * against a specific custom agent instead of always the hardcoded demo
   * agent. Resolved inside handleTurn (lib/agent/orchestrator.ts), which
   * also overrides clientId from the agent's tenant when agentId is valid. */
  agentId?: string;
  /** Tenant auth_user_id, for direct tenant testing without a specific
   * agent. Defaults to the seeded demo tenant. */
  clientId: string;
  /** Roster patient (lib/db/patients.ts) id — lets the test drawer verify
   * appointment-booking tools end to end; those tools refuse to act
   * without either a patientId or a real caller phone number, and a
   * browser test call has neither by default. */
  patientId?: string;
}

/**
 * Handles one browser "Live Test Call" WebSocket connection — the
 * admin-only agent test drawer (app/_components/TestAgentDrawer.tsx), not
 * a real Twilio phone call (see lib/telephony/stream-handler.ts for that).
 *
 * Extracted from server.ts's original inline `wss.on("connection", ...)`
 * closure (same per-connection shape lib/telephony/stream-handler.ts
 * already uses) so this logic can be driven from two different hosts:
 *  - server.ts: a standalone `ws` WebSocketServer for local dev
 *    (`npm run server` / `npm run dev:full`).
 *  - app/api/test-agent/stream/route.ts: a Vercel Function using
 *    `upgradeWebSocket`, for the deployed app.
 */
export class TestAgentStreamHandler {
  private ws: WebSocket;
  private agentId?: string;
  private clientId: string;
  private patientId?: string;
  private sessionId: string;

  private isBusy = false; // prevent overlapping turns while a reply is being generated
  // Tracks whether TTS audio is currently being sent — used by the
  // server-side RMS barge-in fallback below. Previously this path had no
  // server-side barge-in detection at all, relying entirely on the browser's
  // client-side VAD sending a "barge_in" message; this is a safety net for
  // when that's slow, missing, or the client-side VAD fails.
  private isSpeaking = false;

  // Bumped on every user-initiated barge-in. A reply that started synthesizing
  // before the bump is stale by the time it resolves — drop it instead of
  // playing audio over what the user is now saying. Same generation-counter
  // pattern as lib/telephony/stream-handler.ts.
  private generation = 0;
  private turnAudioChunks: Buffer[] = [];
  // Manual acoustic-engine calibration knob (-1..1, default 0), set via the
  // "set_sensitivity_bias" control message — see detectAudioEmotion()'s
  // opts doc in lib/emotion/audio-emotion.ts. Persists for this connection.
  private sensitivityBias = 0;

  // Cancels the in-flight LLM generation for the current turn on barge-in.
  private currentAbortController: AbortController | null = null;
  // ONE Speak connection reused for the whole session (see
  // ensureSpeakStream() below for the same pattern and its rationale — a
  // fresh handshake per turn measured 900ms-5.3s live).
  private currentSpeakStream: SpeakStreamHandle | null = null;
  private speakStreamReadyPromise: Promise<void> | null = null;
  private voiceModel: string = CONFIG.deepgram.ttsModel;
  private useBufferedTts = false;
  // Resolved in voiceSetupPromise, mirroring lib/telephony/
  // stream-handler.ts's setupVoiceForCall() exactly — without this, every
  // browser test call spoke Deepgram/English regardless of the agent's own
  // speech_provider/language (Gnani) setting.
  private speechProvider: SpeechProvider = "deepgram";
  private language: string = "en-IN";
  private gnaniVoice: string = "Nalini";
  private gnaniModel: string = "timbre-v2.5";
  // Agent Builder's "greeting" field — spoken once, proactively, as soon as
  // voice setup resolves, instead of the agent only ever responding once
  // the user speaks first.
  private greeting: string | null = null;

  private stt: LiveSttConnection;
  private sttConnectPromise: Promise<void>;
  private voiceSetupPromise: Promise<void>;

  // Diagnostic: confirm audio frames are actually arriving from the browser,
  // and that the STT provider's internal state is "connected" when we try
  // to forward them (sendAudio silently drops frames otherwise).
  private audioChunkCount = 0;
  private audioByteCount = 0;

  constructor(opts: TestAgentStreamHandlerOptions) {
    this.ws = opts.ws;
    this.agentId = opts.agentId;
    this.clientId = opts.clientId || DEMO.clientId;
    this.patientId = opts.patientId;
    this.sessionId = `browser-${nanoid(12)}`;

    console.log(`\n[TestAgentStream] New client connected. clientId=${this.clientId} agentId=${this.agentId ?? "(none)"} patientId=${this.patientId ?? "(none)"}`);

    // Eagerly opens the DEFAULT (Deepgram) STT connection — the real
    // provider/language isn't known until voiceSetupPromise resolves (needs
    // clientId/agentId, see below). This preserves the "don't lose early
    // audio" latency optimization for the common (Deepgram) case;
    // voiceSetupPromise tears this down and reopens with the resolved
    // provider only when it actually differs — same pattern as
    // lib/telephony/stream-handler.ts's constructor/setupVoiceForCall().
    this.stt = createLiveStt("deepgram", { sampleRate: 16000, language: "en-IN", onTranscript: this.onSttTranscript });
    // Kicked off immediately (not awaited yet) so it's already in flight by
    // the time voiceSetupPromise might need to swap providers — ws's
    // WebSocket throws/emits an error ("WebSocket was closed before the
    // connection was established") if .close() is called on a socket that's
    // still mid-handshake, which an unhandled rejection on this promise would
    // otherwise crash the whole process over (live-reproduced: resolveSpeech-
    // Config resolving to Gnani before Deepgram's real network handshake to
    // api.deepgram.com finished). The Gnani-swap branch below awaits this
    // first (swallowing any failure, since it's discarding the connection
    // either way) so close() is never called on a not-yet-open socket.
    this.sttConnectPromise = this.stt.connect();

    // Register every ws event handler in this same synchronous tick, before
    // awaiting anything — Node's EventEmitter drops events fired before a
    // listener is attached, and a real client starts sending audio the
    // instant the socket opens; if ensureSeeded()/sttConnectPromise were
    // awaited first, any audio sent during that window — a real network
    // round trip, not instant — would be silently lost. The STT provider's
    // sendAudio() already buffers audio while its state is "connecting", so
    // it's safe to start receiving before connect() resolves.
    this.ws.on("message", (message: Buffer, isBinary: boolean) => this.onMessage(message, isBinary));
    this.ws.on("close", (code: number, reason: Buffer) => this.onClose(code, reason));
    this.ws.on("error", (err: Error) => this.onError(err));

    // Resolved once per connection (agent voice persona / tenant ElevenLabs
    // override / speech provider+language / greeting), same rationale as
    // stream-handler.ts's setupVoiceForCall() — avoids a per-turn DB round
    // trip, and kicked off here (not awaited yet) so it overlaps with
    // ensureSeeded()/STT connect below.
    this.voiceSetupPromise = this.setupVoice();

    this.init().catch((err) => {
      console.error("[TestAgentStream] Failed to connect to Deepgram:", err);
      this.ws.send(JSON.stringify({ type: "error", message: "Failed to initialize STT" }));
      this.ws.close();
    });
  }

  // Now that every handler above is attached and the default STT provider
  // is already connecting, it's safe to await the slower setup steps.
  private async init(): Promise<void> {
    await ensureSeeded();
    await this.sttConnectPromise;
    this.ws.send(JSON.stringify({ type: "system", message: "Connected to STT engine", clientId: this.clientId }));
  }

  private ensureSpeakStream(): { stream: SpeakStreamHandle; ready: Promise<void> } {
    if (!this.currentSpeakStream) {
      const stream = createSpeakStream(
        this.speechProvider,
        {
          sampleRate: BROWSER_TTS_SAMPLE_RATE,
          language: this.language,
          voice: this.speechProvider === "gnani" ? this.gnaniVoice : this.voiceModel,
          gnaniModel: this.gnaniModel,
        },
        () => {} // rebound per-turn via setAudioHandler before first use
      );
      this.currentSpeakStream = stream;
      this.speakStreamReadyPromise = stream.connect().catch((err) => {
        console.error(`[TestAgentStream] Speak stream connect failed for ${this.sessionId}:`, err);
        this.currentSpeakStream = null;
        this.speakStreamReadyPromise = null;
      });
    }
    return { stream: this.currentSpeakStream, ready: this.speakStreamReadyPromise! };
  }

  // Shared barge-in trigger — invoked either by the client's own VAD
  // sending {type:"barge_in"}, or by the server-side RMS fallback below.
  // Mirrors lib/telephony/stream-handler.ts's triggerBargeIn().
  private triggerBargeIn(reason: string): void {
    this.generation++;
    this.isBusy = false;
    this.isSpeaking = false;
    this.turnAudioChunks = [];
    this.currentAbortController?.abort();
    // clear() only, not close() — the connection stays open for the next
    // turn (see ensureSpeakStream()).
    this.currentSpeakStream?.clear();
    console.log(`[TestAgentStream] Barge-in (${reason}) — generation now ${this.generation}.`);
  }

  // STT message handler — provider-agnostic, shared by whichever
  // LiveSttConnection `stt` currently points at.
  private onSttTranscript = (text: string, isFinal: boolean): void => {
    // Diagnostic: log every transcript the provider produces, not just
    // finals, so we can tell "STT is receiving audio but never finalizing"
    // apart from "no audio is reaching STT at all."
    console.log(`[STT ${isFinal ? "FINAL" : "interim"}] "${text}"`);

    this.ws.send(JSON.stringify({ type: isFinal ? "transcript_final" : "transcript_interim", text }));

    if (isFinal) {
      void this.onFinalTranscript(text);
    }
  };

  /**
   * Speaks the agent's configured opening line (Agent Builder's `greeting`
   * field) the moment voice setup resolves, instead of the agent only ever
   * responding once the user speaks first. Sends the same reply_text/
   * reply_audio(_chunk) message shapes a normal turn would, tagged with
   * their own turnId, so it shows up in the test drawer's transcript too.
   */
  private async speakGreeting(text: string): Promise<void> {
    void announceGreeting({ sessionId: this.sessionId, userId: DEMO.userId, clientId: this.clientId, text });
    const turnId = nanoid(8);
    this.ws.send(JSON.stringify({ type: "reply_text", turnId, text }));

    if (this.useBufferedTts) {
      const audio = await synthesize(text, { clientId: this.clientId });
      this.ws.send(JSON.stringify({ type: "reply_audio", turnId, ttsMs: 0, audio: Buffer.from(audio).toString("base64"), mime: "audio/mpeg" }));
      return;
    }

    const myGeneration = this.generation;
    const { stream: speakStream, ready: speakStreamReady } = this.ensureSpeakStream();
    speakStream.setAudioHandler((audioChunk) => {
      if (myGeneration !== this.generation) return; // barge-in happened mid-greeting
      this.isSpeaking = true;
      this.ws.send(JSON.stringify({ type: "reply_audio_chunk", turnId, audio: audioChunk.toString("base64"), sampleRate: BROWSER_TTS_SAMPLE_RATE }));
    });
    await speakStreamReady;
    if (myGeneration !== this.generation) return;
    speakStream.sendText(text);
    speakStream.flush();
  }

  private async setupVoice(): Promise<void> {
    try {
      const [agentInfo, voiceSettings] = await Promise.all([
        this.agentId ? getAgentWithTenant(supabase, this.agentId).catch(() => null) : Promise.resolve(null),
        getClientVoiceSettings(this.clientId).catch(() => null),
      ]);
      if (agentInfo?.voice_persona) {
        this.voiceModel = resolveVoiceModel(agentInfo.voice_persona);
      }
      this.greeting = agentInfo?.greeting ?? null;

      if (voiceSettings?.provider === "elevenlabs" && voiceSettings.voiceId) {
        // Neither streaming Speak WS (Deepgram or Gnani) covers a tenant's
        // custom cloned ElevenLabs voice — fall back to the original
        // buffered synth-then-send path for this session only.
        this.useBufferedTts = true;
      } else {
        const speechConfig = await resolveSpeechConfig(this.clientId, this.agentId, agentInfo);
        this.speechProvider = speechConfig.provider;
        this.language = speechConfig.language;

        if (this.speechProvider === "gnani") {
          // Agent's own voice_persona wins; falls back to the tenant's
          // business_settings.voice_persona (resolveSpeechConfig already
          // carried that through), then to the DEFAULT_GNANI_VOICE default.
          const gnani = parseGnaniPersona(agentInfo?.voice_persona ?? speechConfig.voicePersona);
          this.gnaniVoice = gnani.id;
          this.gnaniModel = gnani.model;

          // The eagerly-opened default (Deepgram) STT connection above was
          // already started before this resolved — swap it for Gnani's,
          // same "fast start, then swap only if needed" pattern as
          // stream-handler.ts's setupVoiceForCall(). Only Gnani-routed test
          // calls pay this one reconnect. Must wait for the eager connect to
          // actually settle (success or failure) before closing it — see
          // sttConnectPromise's doc comment above for the crash this avoids.
          await this.sttConnectPromise.catch(() => {});
          this.stt.close();
          this.stt = createLiveStt("gnani", { sampleRate: 16000, language: this.language, onTranscript: this.onSttTranscript });
          this.sttConnectPromise = this.stt.connect();
          await this.sttConnectPromise;
        }

        this.ensureSpeakStream();
      }
    } catch (err) {
      console.warn(`[TestAgentStream] Voice setup failed for ${this.sessionId}, using defaults:`, err);
    }

    if (this.greeting?.trim()) {
      await this.speakGreeting(this.greeting.trim()).catch((err) => console.error(`[TestAgentStream] speakGreeting failed for ${this.sessionId}:`, err));
    }
  }

  private async onFinalTranscript(text: string): Promise<void> {
    if (!text.trim() || this.isBusy) return;
    this.isBusy = true;
    const myGeneration = this.generation;
    this.ws.send(JSON.stringify({ type: "turn_start" }));

    const turnPcm = Buffer.concat(this.turnAudioChunks);
    this.turnAudioChunks = [];
    // Real STT time isn't cleanly measurable per-turn (Deepgram streams
    // interim results continuously while the user is still talking) — the
    // one honest number we have is how long the audio itself ran, which
    // approximates it well enough for the pipeline visual's "Listen" stage.
    const sttMs = Math.round((turnPcm.length / 2 / 16000) * 1000);

    const abortController = new AbortController();
    this.currentAbortController = abortController;

    try {
      console.log(`[STT] User: "${text}"`);

      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const utterancePcm = turnPcm.length > 0 ? isolateLastUtterance(downsample16kTo8k(turnPcm)) : Buffer.alloc(0);
      const acousticFeatures = utterancePcm.length > 0
        ? extractAcousticFeatures(utterancePcm, wordCount)
        : undefined;
      // Raw 16kHz PCM (pre-downsampling) for the wav2vec2 acoustic ML
      // diagnostic engine — the browser mic already captures at this
      // model's native sample rate, so no resampling is needed here.
      const rawAudioPcm16k = turnPcm.length > 0 ? int16ToFloat32Pcm(turnPcm) : undefined;

      await this.voiceSetupPromise;

      const turnInput = {
        sessionId: this.sessionId,
        // A browser test call is a fresh synthetic caller. Reusing the one
        // seeded demo user leaked unrelated cross-call memories into every
        // custom agent test (including mixed-language text), which could
        // steer the reply into the wrong language or persona.
        userId: this.agentId ? this.sessionId : DEMO.userId,
        clientId: this.clientId,
        agentId: this.agentId,
        patientId: this.patientId,
        transcript: text,
        // buildLLMContext's language-matching rule (lib/agent/context.ts)
        // only fires when this is set — without it the browser test drawer
        // always replied in English regardless of what language the caller
        // actually spoke, even though STT (Gnani, when configured) was
        // already transcribing it correctly.
        language: this.language,
        sttConfidence: 0.9,
        acousticFeatures,
        rawAudioPcm16k,
        sensitivityBias: this.sensitivityBias,
        // Full per-engine breakdown (HF/Lexicon/Local ONNX/Acoustic) so the
        // live test drawer can show the same diagnostics the Text demo does,
        // not just the fused label.
        diagnostics: true,
      };

      // Shared id lets the client correlate reply_text and reply_audio_chunk
      // (sent separately, further below) back to the same turn.
      const replyTurnId = nanoid(8);

      if (this.useBufferedTts) {
        // Tenant has a custom ElevenLabs voice — no streaming Speak WS
        // support for that path yet, use the original buffered flow.
        const output = await handleTurn(turnInput);
        if (myGeneration !== this.generation) {
          console.log(`[TestAgentStream] Dropping stale reply (generation ${myGeneration} != ${this.generation}).`);
          return;
        }
        console.log(`[LLM] Reply: "${output.reply}"`);
        if (output.trace.timings) output.trace.timings.sttMs = sttMs;
        this.ws.send(JSON.stringify({ type: "reply_text", turnId: replyTurnId, text: output.reply, trace: output.trace }));

        const ttsStart = Date.now();
        const audio = await synthesize(output.reply, {
          policy: output.trace.policy,
          emotion: output.trace.emotion.current.label,
          persona: output.trace.agent?.voicePersona ?? undefined,
          clientId: this.clientId,
          callerText: text,
        });
        const ttsMs = Date.now() - ttsStart;
        if (myGeneration !== this.generation) return;
        this.isSpeaking = true;
        this.ws.send(JSON.stringify({ type: "reply_audio", turnId: replyTurnId, ttsMs, audio: Buffer.from(audio).toString("base64"), mime: "audio/mpeg" }));
        return;
      }

      const { stream: speakStream, ready: speakStreamReady } = this.ensureSpeakStream();
      speakStream.setAudioHandler((audioChunk) => {
        if (myGeneration !== this.generation) return; // stale — dropped by barge-in
        this.isSpeaking = true;
        this.ws.send(
          JSON.stringify({
            type: "reply_audio_chunk",
            turnId: replyTurnId,
            audio: audioChunk.toString("base64"),
            sampleRate: BROWSER_TTS_SAMPLE_RATE,
          })
        );
      });

      // Resolved via onEmotionResolved below, well before the first clause
      // arrives — lets each streamed clause get the same adaptive-tone
      // pause shaping (BUG-V1) the buffered path applies to the whole
      // reply at once.
      let prosodyParams: TTSProsodyParams | null = null;

      const output = await handleTurn(turnInput, {
        abortSignal: abortController.signal,
        onEmotionResolved: (emotion, policy) => {
          prosodyParams = getEmotionTTSParams(emotion, policy, text);
        },
        onReplyChunk: (clause) => {
          if (myGeneration !== this.generation) return; // stale — dropped by barge-in
          const shaped = prosodyParams ? applyEmotionProsody(clause, prosodyParams) : clause;
          void speakStreamReady.then(() => {
            if (myGeneration !== this.generation) return;
            speakStream.sendText(shaped);
            speakStream.flush();
          });
        },
      });

      if (myGeneration !== this.generation) {
        console.log(`[TestAgentStream] Dropping stale reply (generation ${myGeneration} != ${this.generation}).`);
        return;
      }

      console.log(`[LLM] Reply: "${output.reply}"`);
      if (output.trace.timings) output.trace.timings.sttMs = sttMs;

      // Sent after the clauses have already started streaming as audio —
      // the transcript/trace panel updates a beat behind the caller's first
      // words, same tradeoff lib/telephony/stream-handler.ts makes. Not
      // synthesizing again here (unlike the pre-streaming version) — every
      // clause's audio (already prosody-shaped — see onReplyChunk above)
      // was sent as it was generated.
      this.ws.send(JSON.stringify({ type: "reply_text", turnId: replyTurnId, text: output.reply, trace: output.trace }));
    } catch (err) {
      if (myGeneration !== this.generation) {
        console.log(`[TestAgentStream] Turn cancelled by barge-in for ${this.sessionId}.`);
      } else {
        console.error("[TestAgentStream] Turn error:", err);
        this.ws.send(
          JSON.stringify({
            type: "error",
            message: "Something went wrong generating a reply. Please try again.",
          })
        );
      }
    } finally {
      this.isSpeaking = false;
      this.isBusy = false;
      this.currentAbortController = null;
      this.ws.send(JSON.stringify({ type: "turn_end" }));
    }
  }

  // Handle incoming messages from the client (usually raw audio buffers).
  // Discriminate on `isBinary`, not `Buffer.isBuffer(message)` — this ws
  // version delivers BOTH binary and text frames as Buffer objects, so
  // Buffer.isBuffer() was always true regardless of frame type. That meant
  // every text control message (ping, barge_in, set_sensitivity_bias) was
  // silently misrouted into the "it's audio" branch below — fed to Deepgram
  // as garbage PCM and never reaching the JSON.parse branch at all.
  private onMessage(message: Buffer, isBinary: boolean): void {
    if (isBinary && Buffer.isBuffer(message)) {
      this.audioChunkCount++;
      this.audioByteCount += message.length;
      if (this.audioChunkCount === 1) {
        console.log(`[TestAgentStream] First audio chunk received (${message.length} bytes, sttProvider=${this.stt.provider}).`);
      } else if (this.audioChunkCount % 50 === 0) {
        console.log(`[TestAgentStream] ${this.audioChunkCount} audio chunks received (${this.audioByteCount} bytes total, sttProvider=${this.stt.provider}).`);
      }
      // Server-side RMS barge-in fallback — this path otherwise depends
      // entirely on the browser's client-side VAD sending {type:"barge_in"};
      // this is a safety net for when that's slow, missing, or fails. Reuses
      // lib/telephony/stream-handler.ts's threshold as a starting point —
      // that value was calibrated against 8kHz mulaw telephony audio, and
      // browser mic PCM at 16kHz may have different gain/noise-floor
      // characteristics, so this may need its own tuning if it proves too
      // trigger-happy or too insensitive in practice; it's strictly a
      // fallback behind the (usually faster) client-side VAD either way.
      if (this.isSpeaking) {
        const rms = computeRmsEnergy(message);
        if (rms > CONFIG.telephony.bargeInEnergyThreshold) {
          this.triggerBargeIn(`rms=${rms.toFixed(0)}`);
        }
      }

      // It's raw binary audio -> pump to STT, and accumulate for turn-level
      // acoustic feature extraction.
      try {
        this.stt.sendAudio(message);
      } catch (err) {
        console.error(`[TestAgentStream] stt.sendAudio threw on chunk ${this.audioChunkCount}:`, err);
      }
      this.turnAudioChunks.push(message);
    } else {
      // Handle text control messages
      try {
        const payload = JSON.parse(message.toString());
        if (payload.type === "ping") {
          this.ws.send(JSON.stringify({ type: "pong" }));
        } else if (payload.type === "barge_in") {
          // Client-side VAD detected the user talking over the agent's reply.
          this.triggerBargeIn("client-vad");
        } else if (payload.type === "set_sensitivity_bias") {
          const value = Number(payload.value);
          if (Number.isFinite(value)) {
            this.sensitivityBias = Math.max(-1, Math.min(1, value));
            console.log(`[TestAgentStream] Sensitivity bias set to ${this.sensitivityBias}.`);
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }

  private onClose(code: number, reason: Buffer): void {
    console.log(`[TestAgentStream] Client disconnected (session ${this.sessionId}), code=${code}, reason="${reason.toString()}", audioChunksReceived=${this.audioChunkCount}.`);
    this.stt.close();
    this.currentSpeakStream?.close();
  }

  private onError(err: Error): void {
    console.error("[TestAgentStream] Connection error:", err);
    this.stt.close();
    this.currentSpeakStream?.close();
  }
}
