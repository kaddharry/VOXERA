import { nanoid } from "nanoid";
import WebSocket from "ws";
import { DeepgramLiveWrapper } from "../deepgram/live";
import { synthesizeLinear16 } from "../deepgram/tts";
import { handleTurn } from "../agent/orchestrator";
import { supabase } from "../db/supabase";
import { callQueue } from "../queue/manager";
import { stm } from "../memory/stm";
import { sendSMS } from "./sms";

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

export interface StreamHandlerOptions {
  ws: WebSocket; // The WebSocket connection to Twilio
  callSid: string;
  clientId: string;
  callerNumber: string;
}

/**
 * TelephonyStreamHandler manages the full real-time audio loop for one phone call.
 *
 * Lifecycle:
 *  1. Twilio opens a WebSocket (Media Stream) → this handler receives audio frames
 *  2. Audio is decoded mulaw → PCM → streamed to Deepgram STT
 *  3. On final transcript → handleTurn() (existing orchestrator, zero changes)
 *  4. LLM reply → Deepgram TTS (Linear16 PCM) → μ-law → sent back to Twilio
 *  5. Call ends → DB updated, queue updated
 */
export class TelephonyStreamHandler {
  private ws: WebSocket;
  private callSid: string;
  private clientId: string;
  private callerNumber: string;
  private sessionId: string;
  private userId: string;
  private deepgram: DeepgramLiveWrapper;
  private streamSid: string | null = null;
  private startedAt: number;
  private isBusy = false; // prevent overlapping LLM turns
<<<<<<< HEAD
  private hasEnded = false; // prevent double-invocation of onCallEnded
=======
  private isSpeaking = false; // Issue #8: track if TTS is playing for barge-in
>>>>>>> origin/main

  constructor(opts: StreamHandlerOptions) {
    this.ws = opts.ws;
    this.callSid = opts.callSid;
    this.clientId = opts.clientId;
    this.callerNumber = opts.callerNumber;
    this.sessionId = `tel-${nanoid(12)}`;
    this.userId = `caller-${opts.callerNumber.replace(/\D/g, "")}`;
    this.startedAt = Date.now();

    this.deepgram = new DeepgramLiveWrapper(this.onTranscript.bind(this), { sampleRate: 8000 });
    this.init();
  }

  private async init() {
    callQueue.markCallStarted();
    await this.deepgram.connect();
    await this.updateCallLog({ sessionId: this.sessionId });
    console.log(`[TelephonyStream] Call started: ${this.callSid}, session: ${this.sessionId}`);

    this.ws.on("message", (data: Buffer) => this.onTwilioMessage(data));
    this.ws.on("close", () => this.onCallEnded());
    this.ws.on("error", (err) => {
      console.error(`[TelephonyStream] WebSocket error on ${this.callSid}:`, err);
      this.onCallEnded();
    });
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
        console.log(`[TelephonyStream] Stream started, streamSid: ${this.streamSid}`);
        break;
      }

      case "media": {
        // Twilio sends base64-encoded mulaw audio chunks
        const media = msg.media as Record<string, unknown>;
        if (media?.payload) {
          const mulawBuf = Buffer.from(media.payload as string, "base64");
          const pcmBuf = decodeMulaw(mulawBuf);

          // Issue #8: Barge-in — if caller speaks while TTS is playing, stop playback
          if (this.isSpeaking) {
            this.isSpeaking = false;
            this.sendClearMessage();
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

    console.log(`[TelephonyStream] Transcript (${this.callSid}): "${text}"`);

    try {
      const output = await handleTurn({
        sessionId: this.sessionId,
        userId: this.userId,
        clientId: this.clientId,
        transcript: text,
        sttConfidence: 0.9,
        audioEmotion: null,
      });

      console.log(`[TelephonyStream] Reply (${this.callSid}): "${output.reply}"`);
      await this.speakToTwilio(output.reply);
    } catch (err) {
      console.error(`[TelephonyStream] handleTurn error:`, err);
    } finally {
      this.isBusy = false;
    }
  }

  /**
   * Converts text → Linear16 PCM → G.711 μ-law → sends back to the Twilio Media Stream.
   */
  private async speakToTwilio(text: string) {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;

    try {
<<<<<<< HEAD
      // Request Linear16 PCM from Deepgram for Twilio Media Streams
      const pcmBytes = await synthesize(text, {
        encoding: "linear16",
        sampleRate: 8000,
      });

      // Convert Linear16 PCM to G.711 μ-law
      const mulawAudio = pcmToMulaw(Buffer.from(pcmBytes));
      const base64Audio = mulawAudio.toString("base64");

=======
      // Issue #4: Get linear16 PCM at 8kHz directly from Deepgram (not mp3)
      const pcmBuffer = await synthesizeLinear16(text, { clientId: this.clientId });

      // PCM is now correct 8kHz linear16 — encode to mulaw for Twilio
      const mulawAudio = pcmToMulaw(pcmBuffer);
      const base64Audio = mulawAudio.toString("base64");

      // Twilio Media Stream expects this JSON format to play audio
      this.isSpeaking = true;
>>>>>>> origin/main
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

    callQueue.markCallEnded();
    this.deepgram.close();

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
