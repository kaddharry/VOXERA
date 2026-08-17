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
 */
export function buildConnectTwiml(wsUrl: string, callSid: string): string {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  // Brief greeting while WebSocket handshakes
  response.say(
    { voice: "Polly.Joanna-Neural" },
    "Please hold while we connect you."
  );

  const connect = response.connect();
  const stream = connect.stream({ url: wsUrl });
  // Pass callSid as a custom parameter so stream handler knows which call this is
  stream.parameter({ name: "callSid", value: callSid });

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
    ...(opts.statusCallback && {
      statusCallback: opts.statusCallback,
      statusCallbackEvent: ["completed"],
      statusCallbackMethod: "POST",
    }),
  });

  return { callSid: call.sid, status: call.status };
}
