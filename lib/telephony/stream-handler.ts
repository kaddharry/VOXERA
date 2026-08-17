import { nanoid } from "nanoid";
import WebSocket from "ws";
import { DeepgramLiveWrapper } from "../deepgram/live";
import { synthesizeLinear16 } from "../deepgram/tts";
import { handleTurn } from "../agent/orchestrator";
import type { EmotionLabel } from "../types";
import { supabase } from "../db/supabase";
import { callQueue } from "../queue/manager";
import { stm } from "../memory/stm";
import { sendSMS } from "./sms";
import { CONFIG } from "../config";
import { computeRmsEnergy, extractAcousticFeatures } from "../audio/acoustic";

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
  /** The agent whose prompt/knowledge base should handle this call, resolved
   * from phone_numbers.agentId by the incoming webhook. Undefined falls back
   * to the tenant's default prompt (handleTurn's existing behavior). */
  agentId?: string;
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
 *
 * Issue #14 enhancements:
 *  - Energy-based barge-in: only interrupts TTS when RMS exceeds threshold
 *  - PCM accumulation: collects audio for turn-level acoustic analysis
 *  - Interruption tracking: counts barge-in events for CAI scoring
 */
export class TelephonyStreamHandler {
  private ws: WebSocket;
  private callSid: string;
  private clientId: string;
  private callerNumber: string;
  private agentId?: string;
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

  constructor(opts: StreamHandlerOptions) {
    this.ws = opts.ws;
    this.callSid = opts.callSid;
    this.clientId = opts.clientId;
    this.callerNumber = opts.callerNumber;
    this.agentId = opts.agentId;
    this.sessionId = `tel-${nanoid(12)}`;
    this.userId = `caller-${opts.callerNumber.replace(/\D/g, "")}`;
    this.startedAt = Date.now();
 
    this.deepgram = new DeepgramLiveWrapper(this.onTranscript.bind(this), { sampleRate: 8000 });

    // Register every ws event handler in this same synchronous tick, before
    // awaiting anything in init() below — Node's EventEmitter drops events
    // fired before a listener is attached, and Twilio sends "connected"
    // then "start" within milliseconds of the WS opening. init() awaits a
    // real network round-trip to Deepgram before it used to reach this
    // wiring, which silently dropped "start" (never setting streamSid) on
    // real calls: STT still worked once later "media" frames arrived after
    // the listener attached, but every speakToTwilio() call after that
    // silently no-op'd on `if (!this.streamSid) return;` — the caller heard
    // nothing back despite the agent generating real replies. Same bug
    // class server.ts's realtime demo path already documents fixing.
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
        if (customParams?.caller) this.callerNumber = customParams.caller;

        console.log(`[TelephonyStream] Stream started: callSid=${this.callSid} clientId=${this.clientId}${this.agentId ? ` agentId=${this.agentId}` : ""} streamSid=${this.streamSid}`);

        // Only now do we know the real callSid — updating call_logs any
        // earlier (e.g. in init()) would target a row keyed by whatever
        // wrong/placeholder id we started with and silently match nothing.
        void this.updateCallLog({ sessionId: this.sessionId });
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

          // Issue #14: Energy-based barge-in detection.
          // Only trigger TTS interruption if caller audio RMS exceeds threshold.
          // This prevents false barge-ins from background noise.
          if (this.isSpeaking) {
            const rms = computeRmsEnergy(pcmBuf);
            if (rms > CONFIG.telephony.bargeInEnergyThreshold) {
              this.isSpeaking = false;
              this.turnInterruptionCount++;
              this.sendClearMessage();
              console.log(
                `[TelephonyStream] Barge-in triggered (RMS=${rms.toFixed(0)}, ` +
                `threshold=${CONFIG.telephony.bargeInEnergyThreshold}) for ${this.callSid}`
              );
            }
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
      // Issue #14: Extract acoustic features from accumulated PCM
      const turnPcm = Buffer.concat(this.turnAudioChunks);
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const acousticFeatures = turnPcm.length > 0
        ? extractAcousticFeatures(turnPcm, wordCount)
        : undefined;

      const output = await handleTurn({
        sessionId: this.sessionId,
        userId: this.userId,
        clientId: this.clientId,
        agentId: this.agentId,
        transcript: text,
        sttConfidence: 0.9,
        audioEmotion: null,
        acousticFeatures,
        bargeInCount: this.turnInterruptionCount,
      });
 
      console.log(`[TelephonyStream] Reply (${this.callSid}): "${output.reply}"`);
      await this.speakToTwilio(output.reply, output.trace.emotion.current.label, output.trace.agent?.voicePersona ?? undefined);
    } catch (err) {
      console.error(`[TelephonyStream] handleTurn error:`, err);
    } finally {
      this.isBusy = false;
      // Reset turn-level accumulators for next utterance
      this.turnAudioChunks = [];
      this.turnInterruptionCount = 0;
    }
  }
 
  /**
   * Converts text → Linear16 PCM → G.711 μ-law → sends back to the Twilio Media Stream.
   */
  private async speakToTwilio(text: string, emotionLabel?: EmotionLabel, persona?: string) {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      // Get raw 8kHz Linear16 PCM directly from Deepgram (or the tenant's
      // custom ElevenLabs voice, if configured) — already in the exact
      // format pcmToMulaw expects, no decoding required. `persona` is the
      // Agent Builder agent's own chosen Deepgram voice (voice_persona),
      // when this call is routed through a custom agent — takes priority
      // over the CONFIG default but is still overridden by a tenant-level
      // ElevenLabs voice inside synthesizeLinear16() if one is configured.
      const pcmBytes = await synthesizeLinear16(text, { clientId: this.clientId, emotion: emotionLabel, persona });
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
