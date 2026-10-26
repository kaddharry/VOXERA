import twilio from "twilio";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";

/**
 * Returns a Twilio REST client (lazy-init, server-side only).
 */
export function getTwilioClient() {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    throw new Error(
      "[Twilio] Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN environment variables."
    );
  }
  return twilio(ACCOUNT_SID, AUTH_TOKEN);
}

/**
 * Validates that an incoming HTTP request is genuinely from Twilio.
 * Uses the X-Twilio-Signature header and HMAC-SHA1.
 */
export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  if (!AUTH_TOKEN) return false;
  return twilio.validateRequest(AUTH_TOKEN, signature, url, params);
}

/**
 * Builds TwiML to connect the caller to a Media Stream WebSocket.
 * Twilio will open a WebSocket to `wsUrl` and stream mulaw audio.
 *
 * `customParams` (clientId, agentId, caller, callSid, ...) are sent as
 * `<Parameter>` elements, NOT as query-string params on `wsUrl` — verified
 * live against a real call that Twilio does not reliably forward arbitrary
 * query parameters on the Media Stream connection URL (confirmed by the
 * stream handler receiving `callSid=unknown` on a real call whose TwiML
 * definitely had it in the URL). `<Parameter>` values are the
 * Twilio-documented mechanism: they arrive in the `start` event's
 * `start.customParameters`, which the stream handler now reads instead.
 */
export function buildConnectTwiml(wsUrl: string, customParams: Record<string, string>): string {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  // Brief greeting while WebSocket handshakes
  response.say(
    { voice: "Polly.Joanna-Neural" },
    "Please hold while we connect you."
  );

  const connect = response.connect();
  const stream = connect.stream({ url: wsUrl });
  for (const [name, value] of Object.entries(customParams)) {
    if (value) stream.parameter({ name, value });
  }

  return response.toString();
}

/**
 * TwiML to play a hold / queue message when all agents are busy.
 */
export function buildWaitTwiml(waitTimeSec: number): string {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  const minutes = Math.ceil(waitTimeSec / 60);
  response.say(
    { voice: "Polly.Joanna-Neural" },
    `Thank you for calling. All agents are currently busy. Your estimated wait time is ${minutes} minute${minutes !== 1 ? "s" : ""}. Please hold.`
  );
  response.pause({ length: 5 });
  // Redirect back so Twilio re-checks the queue
  response.redirect({ method: "POST" }, `/api/telephony/incoming`);
  return response.toString();
}

/**
 * TwiML to reject a call when the queue is completely full.
 */
export function buildRejectTwiml(): string {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.say(
    { voice: "Polly.Joanna-Neural" },
    "We are sorry, all lines are currently busy. Please try again later. Goodbye."
  );
  response.hangup();
  return response.toString();
}

/**
 * TwiML to enqueue a call in Twilio's native queue.
 */
export function buildEnqueueTwiml(queueName: string): string {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.say(
    { voice: "Polly.Joanna-Neural" },
    "All agents are busy. Please hold while we place you in the queue."
  );
  response.enqueue(queueName);
  return response.toString();
}

// Twilio rings for 60s by default (its own documented default) before
// declaring "no-answer" — never configured here before, so every unanswered
// follow-up attempt silently ate a full minute of ring time on top of
// whatever retryDelayMinutes the hospital configured. A 3-attempts/1-minute-
// gap schedule was then actually ~2.5 minutes *per attempt* (60s ring + up
// to 30s until the next dispatcher poll + the 60s configured delay), which
// is exactly the "sometimes it calls after 5 minutes" behavior reported —
// the retry delay was real, it just never accounted for ring time at all.
// 20s is enough for a landline/mobile to actually be answered without
// padding every missed call with 40 unnecessary seconds of ringing.
const OUTBOUND_RING_TIMEOUT_SECONDS = 20;

export async function initiateOutboundCall(opts: {
  to: string;
  from?: string;
  webhookUrl: string;
  /** Twilio POSTs the final call status here (completed/busy/no-answer/
   * failed/canceled) once the call ends — see app/api/telephony/status.
   * Without this, call_logs (and any campaign_calls row for this call)
   * stay stuck at "outbound_initiated" forever, since nothing else ever
   * learns whether the call was actually answered. */
  statusCallback?: string;
  /** Seconds to ring before Twilio gives up and reports "no-answer" —
   * defaults to OUTBOUND_RING_TIMEOUT_SECONDS, not Twilio's own 60s default. */
  ringTimeoutSeconds?: number;
}): Promise<{ callSid: string; status: string }> {
  const client = getTwilioClient();
  const fromNumber = opts.from || process.env.TWILIO_PHONE_NUMBER;

  if (!fromNumber || fromNumber === "your_twilio_phone_number_here") {
    throw new Error("Valid TWILIO_PHONE_NUMBER is required for outbound calls.");
  }

  const call = await client.calls.create({
    to: opts.to,
    from: fromNumber,
    url: opts.webhookUrl,
    timeout: opts.ringTimeoutSeconds ?? OUTBOUND_RING_TIMEOUT_SECONDS,
    ...(opts.statusCallback && {
      statusCallback: opts.statusCallback,
      statusCallbackEvent: ["completed"],
      statusCallbackMethod: "POST",
    }),
  });

  return { callSid: call.sid, status: call.status };
}

/**
 * Asks Twilio for a call's current status. Used when a call's status
 * callback never arrived (lib/scheduler/dispatcher.ts's stuck-call sweep):
 * Twilio still knows how the call ended even if its webhook to us was
 * lost. Returns null if Twilio can't be reached or doesn't know the call.
 */
export async function fetchCallStatus(callSid: string): Promise<{ status: string; durationSec: number | null; endedAt: number | null } | null> {
  try {
    const call = await getTwilioClient().calls(callSid).fetch();
    return {
      status: call.status,
      durationSec: call.duration != null ? Number(call.duration) : null,
      endedAt: call.endTime ? new Date(call.endTime).getTime() : null,
    };
  } catch (err) {
    console.warn(`[Twilio] Couldn't fetch status for call ${callSid}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
