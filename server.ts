import { WebSocketServer, WebSocket } from "ws";
import { nanoid } from "nanoid";
import { DeepgramLiveWrapper } from "./lib/deepgram/live";
import { handleTurn } from "./lib/agent/orchestrator";
import { synthesize } from "./lib/deepgram/tts";
import { extractAcousticFeatures } from "./lib/audio/acoustic";
import { int16ToFloat32Pcm } from "./lib/emotion/local-audio-detect";
import { DEMO, ensureSeeded } from "./lib/bootstrap";
import { CONFIG } from "./lib/config";
import { config } from "dotenv";

// Belt-and-suspenders env loading: `npm run server` passes `--env-file=.env.local`
// to tsx/node directly, which is what actually matters — ES module imports are
// hoisted and run before any top-level statement in this file, so module-level
// singletons that read process.env at import time (e.g. lib/util/keys.ts's
// KeyRotator, imported transitively via handleTurn below) would otherwise
// permanently capture an empty env var if dotenv only loaded here.
config({ path: ".env.local" });

const PORT = 3001;
const wss = new WebSocketServer({ port: PORT });

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
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  const agentId = requestUrl.searchParams.get("agentId") || undefined;
  const clientId = requestUrl.searchParams.get("clientId") || DEMO.clientId;
  console.log(`\n[Server] New client connected. clientId=${clientId} agentId=${agentId ?? "(none)"}`);

  const sessionId = `browser-${nanoid(12)}`;
  let isBusy = false; // prevent overlapping turns while a reply is being generated

  // Bumped on every user-initiated barge-in. A reply that started synthesizing
  // before the bump is stale by the time it resolves — drop it instead of
  // playing audio over what the user is now saying.
  let generation = 0;
  let turnAudioChunks: Buffer[] = [];
  // Manual acoustic-engine calibration knob (-1..1, default 0), set via the
  // "set_sensitivity_bias" control message — see detectAudioEmotion()'s
  // opts doc in lib/emotion/audio-emotion.ts. Persists for this connection.
  let sensitivityBias = 0;

  // Initialize Deepgram Live stream wrapper (16kHz — browser mic default)
  const dg = new DeepgramLiveWrapper((text, isFinal) => {
    // Diagnostic: log every transcript Deepgram produces, not just finals,
    // so we can tell "Deepgram is receiving audio but never finalizing" apart
    // from "no audio is reaching Deepgram at all."
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
  }, { sampleRate: 16000 });

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

    try {
      console.log(`[STT] User: "${text}"`);

      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const acousticFeatures = turnPcm.length > 0
        ? extractAcousticFeatures(downsample16kTo8k(turnPcm), wordCount)
        : undefined;
      // Raw 16kHz PCM (pre-downsampling) for the wav2vec2 acoustic ML
      // diagnostic engine — the browser mic already captures at this
      // model's native sample rate, so no resampling is needed here.
      const rawAudioPcm16k = turnPcm.length > 0 ? int16ToFloat32Pcm(turnPcm) : undefined;

      // Safety net for an unusually slow turn (see CONFIG.realtime) — if
      // handleTurn() hasn't resolved within the threshold, speak a short
      // filler so the caller isn't sitting in silence wondering if the
      // call dropped, then continue waiting for the real reply. Cleared
      // the moment handleTurn() actually resolves, so this never fires on
      // an ordinary-latency turn.
      let fillerTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        fillerTimer = null;
        if (myGeneration !== generation) return;
        void synthesize(CONFIG.realtime.turnFillerPhrase, { clientId })
          .then((audio) => {
            if (myGeneration !== generation) return;
            ws.send(
              JSON.stringify({
                type: "reply_audio",
                turnId: `filler-${nanoid(6)}`,
                audio: Buffer.from(audio).toString("base64"),
                mime: "audio/mpeg",
                isFiller: true,
              })
            );
          })
          .catch((err) => console.warn("[Server] Filler synthesis failed:", err));
      }, CONFIG.realtime.turnFillerThresholdMs);

      const output = await handleTurn({
        sessionId,
        userId: DEMO.userId,
        clientId,
        agentId,
        transcript: text,
        sttConfidence: 0.9,
        acousticFeatures,
        rawAudioPcm16k,
        sensitivityBias,
        // Full per-engine breakdown (HF/Lexicon/Local ONNX/Acoustic) so the
        // live test drawer can show the same diagnostics the Text demo does,
        // not just the fused label.
        diagnostics: true,
      });

      if (fillerTimer) clearTimeout(fillerTimer);

      if (myGeneration !== generation) {
        // A barge-in happened while this turn was being generated — the
        // user has already moved on, don't speak a stale reply.
        console.log(`[Server] Dropping stale reply (generation ${myGeneration} != ${generation}).`);
        return;
      }

      console.log(`[LLM] Reply: "${output.reply}"`);

      // Shared id lets the client correlate reply_text and reply_audio (sent
      // separately, further below) back to the same turn — needed to merge
      // ttsMs into the right turn's timings once synthesis finishes.
      const replyTurnId = nanoid(8);
      if (output.trace.timings) {
        output.trace.timings.sttMs = sttMs;
      }

      // Send the reply text (and emotion/engine trace for the dashboard)
      // immediately so the transcript feels instant, then synthesize audio.
      ws.send(
        JSON.stringify({
          type: "reply_text",
          turnId: replyTurnId,
          text: output.reply,
          trace: output.trace,
        })
      );

      const ttsStart = Date.now();
      const audio = await synthesize(output.reply, {
        policy: output.trace.policy,
        emotion: output.trace.emotion.current.label,
        persona: output.trace.agent?.voicePersona ?? undefined,
        clientId,
        callerText: text,
      });
      const ttsMs = Date.now() - ttsStart;

      if (myGeneration !== generation) {
        console.log(`[Server] Dropping stale reply audio (generation ${myGeneration} != ${generation}).`);
        return;
      }

      ws.send(
        JSON.stringify({
          type: "reply_audio",
          turnId: replyTurnId,
          ttsMs,
          audio: Buffer.from(audio).toString("base64"),
          mime: "audio/mpeg",
        })
      );
    } catch (err) {
      console.error("[Server] Turn error:", err);
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Something went wrong generating a reply. Please try again.",
        })
      );
    } finally {
      isBusy = false;
      ws.send(JSON.stringify({ type: "turn_end" }));
    }
  }

  // Diagnostic: confirm audio frames are actually arriving from the browser,
  // and that DeepgramLiveWrapper's internal state is "connected" when we try
  // to forward them (sendAudio silently drops frames otherwise).
  let audioChunkCount = 0;
  let audioByteCount = 0;

  // Start connecting to Deepgram immediately (not awaited yet) and register
  // every ws event handler in this same synchronous tick — before awaiting
  // anything. Node's EventEmitter drops events fired before a listener is
  // attached, and a real client starts sending audio the instant the socket
  // opens; if `ensureSeeded()`/`dg.connect()` were awaited first (as this used
  // to do), any audio sent during that window — a real network round trip to
  // Deepgram, not instant — was silently lost. DeepgramLiveWrapper.sendAudio()
  // already buffers audio while its state is "connecting" (used for its own
  // reconnect logic), so it's safe to start receiving before `connect()`
  // resolves — connect() sets state="connecting" synchronously as its very
  // first action, before this line yields to the event loop.
  const dgConnectPromise = dg.connect();

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
        console.log(`[Server] First audio chunk received (${message.length} bytes, dg state=${dg.getState()}).`);
      } else if (audioChunkCount % 50 === 0) {
        console.log(`[Server] ${audioChunkCount} audio chunks received (${audioByteCount} bytes total, dg state=${dg.getState()}).`);
      }
      // It's raw binary audio -> pump to Deepgram, and accumulate for
      // turn-level acoustic feature extraction.
      try {
        dg.sendAudio(message);
      } catch (err) {
        console.error(`[Server] dg.sendAudio threw on chunk ${audioChunkCount}:`, err);
      }
      turnAudioChunks.push(message);
    } else {
      // Handle text control messages
      try {
        const payload = JSON.parse(message.toString());
        if (payload.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        } else if (payload.type === "barge_in") {
          // Client-side VAD detected the user talking over the agent's
          // reply — invalidate whatever's in flight and start a fresh turn.
          generation++;
          isBusy = false;
          turnAudioChunks = [];
          console.log(`[Server] Barge-in — generation now ${generation}.`);
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
    dg.close();
  });

  ws.on("error", (err) => {
    console.error("[Server] Connection error:", err);
    dg.close();
  });

  // Now that every handler above is attached and Deepgram is already
  // connecting, it's safe to await the slower setup steps.
  try {
    await ensureSeeded();
    await dgConnectPromise;
    ws.send(JSON.stringify({ type: "system", message: "Connected to Deepgram STT engine", clientId }));
  } catch (err) {
    console.error("[Server] Failed to connect to Deepgram:", err);
    ws.send(JSON.stringify({ type: "error", message: "Failed to initialize STT" }));
    ws.close();
  }
});
