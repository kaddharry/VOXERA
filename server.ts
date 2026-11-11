import { WebSocketServer, WebSocket } from "ws";
import { nanoid } from "nanoid";
import { announceGreeting, handleTurn } from "./lib/agent/orchestrator";
import { synthesize, resolveVoiceModel, getClientVoiceSettings } from "./lib/deepgram/tts";
import { applyEmotionProsody, getEmotionTTSParams, type TTSProsodyParams } from "./lib/emotion/tts-params";
import { getAgentWithTenant } from "./lib/db/agents";
import { supabase } from "./lib/db/supabase";
import { createLiveStt, createSpeakStream } from "./lib/speech/factory";
import { resolveSpeechConfig } from "./lib/speech/resolve";
import { parseGnaniPersona } from "./lib/tts/gnani-voices";
import type { LiveSttConnection, SpeakStreamHandle, SpeechProvider } from "./lib/speech/types";
import { extractAcousticFeatures, computeRmsEnergy, isolateLastUtterance } from "./lib/audio/acoustic";
import { int16ToFloat32Pcm } from "./lib/emotion/local-audio-detect";
import { DEMO, ensureSeeded } from "./lib/bootstrap";
import { CONFIG } from "./lib/config";
import { config } from "dotenv";
import { warmupModels } from "./lib/warmup";

// Belt-and-suspenders env loading: `npm run server` passes `--env-file=.env.local`
// to tsx/node directly, which is what actually matters — ES module imports are
// hoisted and run before any top-level statement in this file, so module-level
// singletons that read process.env at import time (e.g. lib/util/keys.ts's
// KeyRotator, imported transitively via handleTurn below) would otherwise
// permanently capture an empty env var if dotenv only loaded here.
config({ path: ".env.local" });

// See lib/warmup.ts — avoids paying ONNX model cold-load cost on whichever
// turn happens to be first.
void warmupModels();

const PORT = process.env.REALTIME_SERVER_PORT ? Number(process.env.REALTIME_SERVER_PORT) : 3001;
const wss = new WebSocketServer({ port: PORT });

// Sample rate for browser TTS playback. Not constrained by Twilio's 8kHz
// requirement (unlike lib/telephony/stream-handler.ts) — the browser's Web
// Audio API resamples an AudioBuffer at any declared rate transparently, so
// this is just "what quality does Deepgram render at," picked for clarity
// over telephony-grade compression.
const BROWSER_TTS_SAMPLE_RATE = 24000;

console.log(`\n🚀 VOXERA Real-Time Audio Server starting on ws://localhost:${PORT}`);

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

wss.on("connection", async (ws: WebSocket, request) => {
  // Optional ?agentId=<Agent Builder agent id> lets the live test drawer
  // test against a specific custom agent — its own system prompt and its
  // owning tenant's knowledge base — instead of always the hardcoded demo
  // agent. Resolved inside handleTurn (lib/agent/orchestrator.ts), which
  // also overrides clientId from the agent's tenant when agentId is valid.
  // ?clientId=<tenant auth_user_id> is kept for direct tenant testing
  // without a specific agent (legacy /api/tenants selector, still valid).
  // ?patientId=<lib/db/patients.ts roster patient id> lets the test drawer
  // verify appointment-booking tools (lib/agent/tools.ts's
  // resolveVerifiedPatient) end to end — those tools refuse to act without
  // either a patientId or a real caller phone number, and a browser test
  // call has neither by default.
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const agentId = requestUrl.searchParams.get("agentId") || undefined;
  const clientId = requestUrl.searchParams.get("clientId") || DEMO.clientId;
  const patientId = requestUrl.searchParams.get("patientId") || undefined;
  console.log(`\n[Server] New client connected. clientId=${clientId} agentId=${agentId ?? "(none)"} patientId=${patientId ?? "(none)"}`);

  const sessionId = `browser-${nanoid(12)}`;
  let isBusy = false; // prevent overlapping turns while a reply is being generated
  // Tracks whether TTS audio is currently being sent — used by the
  // server-side RMS barge-in fallback below. Previously this path had no
  // server-side barge-in detection at all, relying entirely on the browser's
  // client-side VAD sending a "barge_in" message; this is a safety net for
  // when that's slow, missing, or the client-side VAD fails.
  let isSpeaking = false;

  // Bumped on every user-initiated barge-in. A reply that started synthesizing
  // before the bump is stale by the time it resolves — drop it instead of
  // playing audio over what the user is now saying. Same generation-counter
  // pattern as lib/telephony/stream-handler.ts.
  let generation = 0;
  let turnAudioChunks: Buffer[] = [];
  // Manual acoustic-engine calibration knob (-1..1, default 0), set via the
  // "set_sensitivity_bias" control message — see detectAudioEmotion()'s
  // opts doc in lib/emotion/audio-emotion.ts. Persists for this connection.
  let sensitivityBias = 0;

  // Cancels the in-flight LLM generation for the current turn on barge-in.
  let currentAbortController: AbortController | null = null;
  // ONE Speak connection reused for the whole session (see
  // ensureSpeakStream() in stream-handler.ts for the same pattern and its
  // rationale — a fresh handshake per turn measured 900ms-5.3s live).
  let currentSpeakStream: SpeakStreamHandle | null = null;
  let speakStreamReadyPromise: Promise<void> | null = null;
  let voiceModel: string = CONFIG.deepgram.ttsModel;
  let useBufferedTts = false;
  // Resolved in voiceSetupPromise below, mirroring lib/telephony/
  // stream-handler.ts's setupVoiceForCall() exactly — this is what was
  // previously missing here entirely, so every browser test call spoke
  // Deepgram/English regardless of the agent's own speech_provider/
  // language (Gnani) setting.
  let speechProvider: SpeechProvider = "deepgram";
  let language: string = "en-IN";
  let gnaniVoice: string = "Nalini";
  let gnaniModel: string = "timbre-v2.5";
  // Agent Builder's "greeting" field — spoken once, proactively, as soon as
  // voice setup resolves (see the bottom of voiceSetupPromise below),
  // instead of the agent only ever responding once the user speaks first.
  let greeting: string | null = null;

  function ensureSpeakStream(): { stream: SpeakStreamHandle; ready: Promise<void> } {
    if (!currentSpeakStream) {
      const stream = createSpeakStream(
        speechProvider,
        {
          sampleRate: BROWSER_TTS_SAMPLE_RATE,
          language,
          voice: speechProvider === "gnani" ? gnaniVoice : voiceModel,
          gnaniModel,
        },
        () => {} // rebound per-turn via setAudioHandler before first use
      );
      currentSpeakStream = stream;
      speakStreamReadyPromise = stream.connect().catch((err) => {
        console.error(`[Server] Speak stream connect failed for ${sessionId}:`, err);
        currentSpeakStream = null;
        speakStreamReadyPromise = null;
      });
    }
    return { stream: currentSpeakStream, ready: speakStreamReadyPromise! };
  }

  // Shared barge-in trigger — invoked either by the client's own VAD
  // sending {type:"barge_in"}, or by the server-side RMS fallback below.
  // Mirrors lib/telephony/stream-handler.ts's triggerBargeIn().
  function triggerBargeIn(reason: string) {
    generation++;
    isBusy = false;
    isSpeaking = false;
    turnAudioChunks = [];
    currentAbortController?.abort();
    // clear() only, not close() — the connection stays open for the next
    // turn (see ensureSpeakStream()).
    currentSpeakStream?.clear();
    console.log(`[Server] Barge-in (${reason}) — generation now ${generation}.`);
  }

  // STT message handler — provider-agnostic (see onSttTranscript below),
  // shared by whichever LiveSttConnection `stt` currently points at.
  function onSttTranscript(text: string, isFinal: boolean) {
    // Diagnostic: log every transcript the provider produces, not just
    // finals, so we can tell "STT is receiving audio but never finalizing"
    // apart from "no audio is reaching STT at all."
    console.log(`[STT ${isFinal ? "FINAL" : "interim"}] "${text}"`);

    ws.send(
      JSON.stringify({
        type: isFinal ? "transcript_final" : "transcript_interim",
        text,
      })
    );

    if (isFinal) {
      void onFinalTranscript(text);
    }
  }

  // Eagerly opens the DEFAULT (Deepgram) STT connection — the real
  // provider/language isn't known until voiceSetupPromise resolves (needs
  // clientId/agentId, see below). This preserves the "don't lose early
  // audio" latency optimization for the common (Deepgram) case;
  // voiceSetupPromise tears this down and reopens with the resolved
  // provider only when it actually differs — same pattern as
  // lib/telephony/stream-handler.ts's constructor/setupVoiceForCall().
  let stt: LiveSttConnection = createLiveStt("deepgram", { sampleRate: 16000, language: "en-IN", onTranscript: onSttTranscript });
  // Kicked off immediately (not awaited yet) so it's already in flight by
  // the time voiceSetupPromise below might need to swap providers — ws's
  // WebSocket throws/emits an error ("WebSocket was closed before the
  // connection was established") if .close() is called on a socket that's
  // still mid-handshake, which an unhandled rejection on this promise would
  // otherwise crash the whole process over (live-reproduced: resolveSpeech-
  // Config resolving to Gnani before Deepgram's real network handshake to
  // api.deepgram.com finished). The Gnani-swap branch below awaits this
  // first (swallowing any failure, since it's discarding the connection
  // either way) so close() is never called on a not-yet-open socket.
  let sttConnectPromise: Promise<void> = stt.connect();

  /**
   * Speaks the agent's configured opening line (Agent Builder's `greeting`
   * field) the moment voice setup resolves, instead of the agent only ever
   * responding once the user speaks first. Sends the same reply_text/
   * reply_audio(_chunk) message shapes a normal turn would, tagged with
   * their own turnId, so it shows up in the test drawer's transcript too.
   */
  async function speakGreeting(text: string): Promise<void> {
    void announceGreeting({ sessionId, userId: DEMO.userId, clientId, text });
    const turnId = nanoid(8);
    ws.send(JSON.stringify({ type: "reply_text", turnId, text }));

    if (useBufferedTts) {
      const audio = await synthesize(text, { clientId });
      ws.send(JSON.stringify({ type: "reply_audio", turnId, ttsMs: 0, audio: Buffer.from(audio).toString("base64"), mime: "audio/mpeg" }));
      return;
    }

    const myGeneration = generation;
    const { stream: speakStream, ready: speakStreamReady } = ensureSpeakStream();
    speakStream.setAudioHandler((audioChunk) => {
      if (myGeneration !== generation) return; // barge-in happened mid-greeting
      isSpeaking = true;
      ws.send(JSON.stringify({ type: "reply_audio_chunk", turnId, audio: audioChunk.toString("base64"), sampleRate: BROWSER_TTS_SAMPLE_RATE }));
    });
    await speakStreamReady;
    if (myGeneration !== generation) return;
    speakStream.sendText(text);
    speakStream.flush();
  }

  // Resolved once per connection (agent voice persona / tenant ElevenLabs
  // override / speech provider+language / greeting), same rationale as
  // stream-handler.ts's setupVoiceForCall() — avoids a per-turn DB round
  // trip, and kicked off here (not awaited yet) so it overlaps with
  // ensureSeeded()/STT connect below.
  const voiceSetupPromise = (async () => {
    try {
      const [agentInfo, voiceSettings] = await Promise.all([
        agentId ? getAgentWithTenant(supabase, agentId).catch(() => null) : Promise.resolve(null),
        getClientVoiceSettings(clientId).catch(() => null),
      ]);
      if (agentInfo?.voice_persona) {
        voiceModel = resolveVoiceModel(agentInfo.voice_persona);
      }
      greeting = agentInfo?.greeting ?? null;

      if (voiceSettings?.provider === "elevenlabs" && voiceSettings.voiceId) {
        // Neither streaming Speak WS (Deepgram or Gnani) covers a tenant's
        // custom cloned ElevenLabs voice — fall back to the original
        // buffered synth-then-send path for this session only.
        useBufferedTts = true;
      } else {
        const speechConfig = await resolveSpeechConfig(clientId, agentId, agentInfo);
        speechProvider = speechConfig.provider;
        language = speechConfig.language;

        if (speechProvider === "gnani") {
          // Agent's own voice_persona wins; falls back to the tenant's
          // business_settings.voice_persona (resolveSpeechConfig already
          // carried that through), then to the DEFAULT_GNANI_VOICE default.
          const gnani = parseGnaniPersona(agentInfo?.voice_persona ?? speechConfig.voicePersona);
          gnaniVoice = gnani.id;
          gnaniModel = gnani.model;

          // The eagerly-opened default (Deepgram) STT connection above was
          // already started before this resolved — swap it for Gnani's,
          // same "fast start, then swap only if needed" pattern as
          // stream-handler.ts's setupVoiceForCall(). Only Gnani-routed test
          // calls pay this one reconnect. Must wait for the eager connect to
          // actually settle (success or failure) before closing it — see
          // sttConnectPromise's doc comment above for the crash this avoids.
          await sttConnectPromise.catch(() => {});
          stt.close();
          stt = createLiveStt("gnani", { sampleRate: 16000, language, onTranscript: onSttTranscript });
          sttConnectPromise = stt.connect();
          await sttConnectPromise;
        }

        ensureSpeakStream();
      }
    } catch (err) {
      console.warn(`[Server] Voice setup failed for ${sessionId}, using defaults:`, err);
    }

    if (greeting?.trim()) {
      await speakGreeting(greeting.trim()).catch((err) => console.error(`[Server] speakGreeting failed for ${sessionId}:`, err));
    }
  })();

  async function onFinalTranscript(text: string) {
    if (!text.trim() || isBusy) return;
    isBusy = true;
    const myGeneration = generation;
    ws.send(JSON.stringify({ type: "turn_start" }));

    const turnPcm = Buffer.concat(turnAudioChunks);
    turnAudioChunks = [];
    // Real STT time isn't cleanly measurable per-turn (Deepgram streams
    // interim results continuously while the user is still talking) — the
    // one honest number we have is how long the audio itself ran, which
    // approximates it well enough for the pipeline visual's "Listen" stage.
    const sttMs = Math.round((turnPcm.length / 2 / 16000) * 1000);

    const abortController = new AbortController();
    currentAbortController = abortController;

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

      await voiceSetupPromise;

      const turnInput = {
        sessionId,
        userId: DEMO.userId,
        clientId,
        agentId,
        patientId,
        transcript: text,
        // Missing here entirely until now — buildLLMContext's language-
        // matching rule (lib/agent/context.ts) only fires when this is set,
        // so the browser test drawer always replied in English regardless
        // of what language the caller actually spoke, even though STT
        // (Gnani, when configured) was already transcribing it correctly.
        // lib/telephony/stream-handler.ts already threaded this through for
        // real calls; this brings the test drawer in line with it.
        language,
        sttConfidence: 0.9,
        acousticFeatures,
        rawAudioPcm16k,
        sensitivityBias,
        // Full per-engine breakdown (HF/Lexicon/Local ONNX/Acoustic) so the
        // live test drawer can show the same diagnostics the Text demo does,
        // not just the fused label.
        diagnostics: true,
      };

      // Shared id lets the client correlate reply_text and reply_audio_chunk
      // (sent separately, further below) back to the same turn.
      const replyTurnId = nanoid(8);

      if (useBufferedTts) {
        // Tenant has a custom ElevenLabs voice — no streaming Speak WS
        // support for that path yet, use the original buffered flow.
        const output = await handleTurn(turnInput);
        if (myGeneration !== generation) {
          console.log(`[Server] Dropping stale reply (generation ${myGeneration} != ${generation}).`);
          return;
        }
        console.log(`[LLM] Reply: "${output.reply}"`);
        if (output.trace.timings) output.trace.timings.sttMs = sttMs;
        ws.send(JSON.stringify({ type: "reply_text", turnId: replyTurnId, text: output.reply, trace: output.trace }));

        const ttsStart = Date.now();
        const audio = await synthesize(output.reply, {
          policy: output.trace.policy,
          emotion: output.trace.emotion.current.label,
          persona: output.trace.agent?.voicePersona ?? undefined,
          clientId,
          callerText: text,
        });
        const ttsMs = Date.now() - ttsStart;
        if (myGeneration !== generation) return;
        isSpeaking = true;
        ws.send(JSON.stringify({ type: "reply_audio", turnId: replyTurnId, ttsMs, audio: Buffer.from(audio).toString("base64"), mime: "audio/mpeg" }));
        return;
      }

      const { stream: speakStream, ready: speakStreamReady } = ensureSpeakStream();
      speakStream.setAudioHandler((audioChunk) => {
        if (myGeneration !== generation) return; // stale — dropped by barge-in
        isSpeaking = true;
        ws.send(
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
          if (myGeneration !== generation) return; // stale — dropped by barge-in
          const shaped = prosodyParams ? applyEmotionProsody(clause, prosodyParams) : clause;
          void speakStreamReady.then(() => {
            if (myGeneration !== generation) return;
            speakStream.sendText(shaped);
            speakStream.flush();
          });
        },
      });

      if (myGeneration !== generation) {
        console.log(`[Server] Dropping stale reply (generation ${myGeneration} != ${generation}).`);
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
      ws.send(JSON.stringify({ type: "reply_text", turnId: replyTurnId, text: output.reply, trace: output.trace }));
    } catch (err) {
      if (myGeneration !== generation) {
        console.log(`[Server] Turn cancelled by barge-in for ${sessionId}.`);
      } else {
        console.error("[Server] Turn error:", err);
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Something went wrong generating a reply. Please try again.",
          })
        );
      }
    } finally {
      isSpeaking = false;
      isBusy = false;
      currentAbortController = null;
      ws.send(JSON.stringify({ type: "turn_end" }));
    }
  }

  // Diagnostic: confirm audio frames are actually arriving from the browser,
  // and that DeepgramLiveWrapper's internal state is "connected" when we try
  // to forward them (sendAudio silently drops frames otherwise).
  let audioChunkCount = 0;
  let audioByteCount = 0;

  // The default STT connection was already kicked off above (sttConnectPromise,
  // declared alongside `stt`) — not awaited yet, so every ws event handler
  // below gets registered in this same synchronous tick, before awaiting
  // anything. Node's EventEmitter drops events fired before a listener is
  // attached, and a real client starts sending audio the instant the socket
  // opens; if `ensureSeeded()`/`sttConnectPromise` were awaited first (as
  // this used to do), any audio sent during that window — a real network
  // round trip, not instant — was silently lost. DeepgramLiveWrapper.
  // sendAudio() already buffers audio while its state is "connecting" (used
  // for its own reconnect logic), so it's safe to start receiving before
  // `connect()` resolves.

  // Handle incoming messages from the client (usually raw audio buffers).
  // Discriminate on `isBinary`, not `Buffer.isBuffer(message)` — this ws
  // version delivers BOTH binary and text frames as Buffer objects, so
  // Buffer.isBuffer() was always true regardless of frame type. That meant
  // every text control message (ping, barge_in, and this file's new
  // set_sensitivity_bias) was silently misrouted into the "it's audio"
  // branch below — fed to Deepgram as garbage PCM and never reaching the
  // JSON.parse branch at all. Found while live-testing set_sensitivity_bias
  // against a real running server; a real pre-existing bug, not new.
  ws.on("message", (message, isBinary) => {
    if (isBinary && Buffer.isBuffer(message)) {
      audioChunkCount++;
      audioByteCount += message.length;
      if (audioChunkCount === 1) {
        console.log(`[Server] First audio chunk received (${message.length} bytes, sttProvider=${stt.provider}).`);
      } else if (audioChunkCount % 50 === 0) {
        console.log(`[Server] ${audioChunkCount} audio chunks received (${audioByteCount} bytes total, sttProvider=${stt.provider}).`);
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
      if (isSpeaking) {
        const rms = computeRmsEnergy(message);
        if (rms > CONFIG.telephony.bargeInEnergyThreshold) {
          triggerBargeIn(`rms=${rms.toFixed(0)}`);
        }
      }

      // It's raw binary audio -> pump to STT, and accumulate for turn-level
      // acoustic feature extraction.
      try {
        stt.sendAudio(message);
      } catch (err) {
        console.error(`[Server] stt.sendAudio threw on chunk ${audioChunkCount}:`, err);
      }
      turnAudioChunks.push(message);
    } else {
      // Handle text control messages
      try {
        const payload = JSON.parse(message.toString());
        if (payload.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        } else if (payload.type === "barge_in") {
          // Client-side VAD detected the user talking over the agent's reply.
          triggerBargeIn("client-vad");
        } else if (payload.type === "set_sensitivity_bias") {
          const value = Number(payload.value);
          if (Number.isFinite(value)) {
            sensitivityBias = Math.max(-1, Math.min(1, value));
            console.log(`[Server] Sensitivity bias set to ${sensitivityBias}.`);
          }
        }
      } catch (e) {
        // ignore
      }
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`[Server] Client disconnected (session ${sessionId}), code=${code}, reason="${reason.toString()}", audioChunksReceived=${audioChunkCount}.`);
    stt.close();
    currentSpeakStream?.close();
  });

  ws.on("error", (err) => {
    console.error("[Server] Connection error:", err);
    stt.close();
    currentSpeakStream?.close();
  });

  // Now that every handler above is attached and the default STT provider
  // is already connecting, it's safe to await the slower setup steps.
  try {
    await ensureSeeded();
    await sttConnectPromise;
    ws.send(JSON.stringify({ type: "system", message: "Connected to STT engine", clientId }));
  } catch (err) {
    console.error("[Server] Failed to connect to Deepgram:", err);
    ws.send(JSON.stringify({ type: "error", message: "Failed to initialize STT" }));
    ws.close();
  }
});
