/**
 * End-to-end reproduction of the REAL browser "Live Test Call" path,
 * against the ACTUALLY RUNNING server.ts — no mocks, no direct function
 * calls. Synthesizes a fake "spoken" question as 16kHz PCM (matching the
 * browser mic's real format), streams it into the live WebSocket exactly
 * like the frontend's AudioWorklet does, and logs every server message
 * with a precise timestamp so we can see, second by second, what's
 * actually happening — not what the code is supposed to do.
 *
 * Usage: npx tsx --env-file=.env.local scripts/browser_path_e2e_test.ts
 * (set REALTIME_SERVER_PORT to target a non-default port)
 */
import WebSocket from "ws";

const AGENT_ID = "4a7d5dc8-e206-45e1-9822-6d50f520d0e2"; // "Vikas Verma" agent
const CLIENT_ID = "176d6905-2e3b-4e28-a608-02d7836cb95b"; // its tenant
const QUESTION = "Can you tell me about your experience at Tredence?";

async function synthesizeQuestionAsPcm16k(text: string): Promise<Buffer> {
  const key = process.env.DEEPGRAM_API_KEY!;
  const res = await fetch(
    "https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=linear16&sample_rate=16000&container=none",
    {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }
  );
  if (!res.ok) throw new Error(`TTS synth failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  console.log(`Synthesizing fake "spoken" question: "${QUESTION}"...`);
  const pcm = await synthesizeQuestionAsPcm16k(QUESTION);
  console.log(`Got ${pcm.length} bytes of 16kHz PCM (~${(pcm.length / 2 / 16000).toFixed(2)}s of audio).\n`);

  const port = process.env.REALTIME_SERVER_PORT || "3001";
  const url = `ws://localhost:${port}?agentId=${AGENT_ID}&clientId=${CLIENT_ID}`;
  const ws = new WebSocket(url);
  const t0 = Date.now();
  const log = (label: string, extra?: string) =>
    console.log(`[+${(Date.now() - t0).toString().padStart(6)}ms] ${label}${extra ? " — " + extra : ""}`);

  let audioChunkCount = 0;
  let firstChunkAt: number | null = null;
  let lastChunkAt: number | null = null;
  let turnStartAt: number | null = null;
  let turnEndAt: number | null = null;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleQuietClose = () => {
    if (quietTimer) clearTimeout(quietTimer);
    // Conclude the turn is truly finished after 2.5s with no new audio
    // chunk — turn_end fires once the LLM finishes generating TEXT, not
    // once Deepgram has finished streaming back all the corresponding
    // audio, so closing right on turn_end would (and did, in an earlier
    // version of this script) cut off and miss audio that's still on the
    // way, misreporting a working stream as broken.
    quietTimer = setTimeout(() => {
      log(`Quiet period elapsed — concluding turn is done.`);
      log(`SUMMARY: ${audioChunkCount} audio chunks total.`);
      if (turnStartAt && firstChunkAt) log(`  time turn_start -> FIRST audio chunk: ${firstChunkAt - turnStartAt}ms`);
      if (turnEndAt && firstChunkAt) log(`  time turn_end -> FIRST audio chunk: ${firstChunkAt - turnEndAt}ms (negative = audio started before turn_end)`);
      if (firstChunkAt && lastChunkAt) log(`  time FIRST audio chunk -> LAST audio chunk (spread): ${lastChunkAt - firstChunkAt}ms`);
      ws.close();
    }, 2500);
  };

  ws.on("open", () => log("WS OPEN"));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "reply_audio_chunk") {
        audioChunkCount++;
        const now = Date.now();
        if (firstChunkAt === null) {
          firstChunkAt = now;
          log("FIRST reply_audio_chunk received", `turnId=${msg.turnId}`);
        }
        lastChunkAt = now;
        scheduleQuietClose();
        return; // don't spam every chunk after the first
      }
      if (msg.type === "transcript_interim") return; // too noisy
      log(`msg: ${msg.type}`, msg.type === "reply_text" ? JSON.stringify(msg.text) : msg.type === "system" ? msg.message : "");
      if (msg.type === "turn_start") turnStartAt = Date.now();
      if (msg.type === "turn_end") {
        turnEndAt = Date.now();
        scheduleQuietClose(); // in case audio already finished before turn_end
      }
    } catch {
      // ignore
    }
  });

  ws.on("close", () => {
    log("WS CLOSED");
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("WS ERROR:", err);
    process.exit(1);
  });

  // Wait for the "system" ready message, THEN stream the fake audio in
  // realistic ~100ms chunks (1600 samples @ 16kHz), matching the real
  // frontend's SEND_CHUNK_SAMPLES pacing — not all at once, which would be
  // unrealistic and could make Deepgram finalize differently than real speech.
  await new Promise<void>((resolve) => {
    ws.once("message", function readyCheck(raw) {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "system") {
          log("Deepgram STT ready, starting to stream fake audio...");
          resolve();
        } else {
          ws.once("message", readyCheck);
        }
      } catch {
        ws.once("message", readyCheck);
      }
    });
  });

  const CHUNK_SAMPLES = 1600;
  const CHUNK_BYTES = CHUNK_SAMPLES * 2;
  for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
    const chunk = pcm.subarray(offset, Math.min(offset + CHUNK_BYTES, pcm.length));
    ws.send(chunk);
    await new Promise((r) => setTimeout(r, 100));
  }
  log("Finished streaming fake audio — waiting for STT to finalize + agent reply...");

  // Trailing silence so Deepgram's endpointing/utterance_end actually fires
  // (it needs real silence after speech, same as a real caller pausing).
  const SILENCE_MS = 2000;
  const silenceChunk = Buffer.alloc(CHUNK_BYTES);
  const silenceChunks = Math.ceil(SILENCE_MS / 100);
  for (let i = 0; i < silenceChunks; i++) {
    ws.send(silenceChunk);
    await new Promise((r) => setTimeout(r, 100));
  }

  // Safety timeout
  setTimeout(() => {
    log("TIMEOUT — closing.");
    ws.close();
  }, 40000);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
