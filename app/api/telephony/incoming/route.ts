import { NextRequest, NextResponse } from "next/server";
import { validateTwilioSignature, buildConnectTwiml, buildEnqueueTwiml, buildRejectTwiml } from "../../../../lib/telephony/twilio";
import { callQueue } from "../../../../lib/queue/manager";
import { supabase } from "../../../../lib/db/supabase";

export const dynamic = "force-dynamic";

const MAX_CONCURRENT_CALLS = 10;

/**
 * POST /api/telephony/incoming
 *
 * Twilio calls this webhook when a phone call arrives.
 * We respond with TwiML that either:
 *   a) Opens a Media Stream WebSocket (normal path)
 *   b) Enqueues the call natively on Twilio (queue full but under hard limit)
 *   c) Rejects the call (hard limit reached)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const params = Object.fromEntries(new URLSearchParams(body));

    const callSid = params.CallSid || "";
    const callerNumber = params.From || "unknown";
    const toNumber = params.To || "";

    console.log(`[Telephony] Incoming call: ${callSid} from ${callerNumber} to ${toNumber}`);

    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken) {
      const signature = req.headers.get("x-twilio-signature") || "";
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
      // Must include the query string exactly as configured on the call's
      // webhook `url` — Twilio signs the full URL it was given, including
      // ?clientId=/&agentId= appended for outbound campaign calls below.
      // Reconstructing without it would make every outbound-triggered call
      // fail signature validation.
      const webhookUrl = `${baseUrl}/api/telephony/incoming${req.nextUrl.search}`;
      const isValid = validateTwilioSignature(webhookUrl, params, signature);
      if (!isValid) {
        console.warn("[Telephony] Invalid Twilio signature — rejecting request");
        return new NextResponse("Forbidden", { status: 403 });
      }
    }

    // Outbound calls (single "Place Outbound Call" or a bulk campaign) set
    // clientId/agentId as query params on the webhook URL they gave Twilio,
    // since `To` on an outbound call's callback is the recipient we dialed,
    // not one of our own registered numbers — the phone_numbers lookup
    // below only applies to genuine inbound calls, which never carry these.
    const queryClientId = req.nextUrl.searchParams.get("clientId");
    const queryAgentId = req.nextUrl.searchParams.get("agentId");

    let clientId: string;
    let agentId: string | undefined;

    if (queryClientId) {
      clientId = queryClientId;
      agentId = queryAgentId ?? undefined;
    } else {
      const { data: phoneRow } = await supabase
        .from("phone_numbers")
        .select("clientId, agentId")
        .eq("phoneNumber", toNumber)
        .eq("active", true)
        .single();

      clientId = phoneRow?.clientId || process.env.DEFAULT_CLIENT_ID || "demo";
      // The specific agent assigned to this number (Settings > Phone Numbers),
      // if any — falls through to the tenant's default prompt when unset.
      agentId = phoneRow?.agentId ?? undefined;
    }

    const activeCount = await callQueue.getActiveCallCount();

    if (activeCount >= MAX_CONCURRENT_CALLS) {
      console.warn(`[Telephony] Hard limit reached (${activeCount} calls). Rejecting ${callSid}.`);
      return new NextResponse(buildRejectTwiml(), {
        headers: { "Content-Type": "text/xml" },
      });
    }

    // Determine priority based on callerNumber (premium numbers get higher priority, e.g. 1)
    const priority = callerNumber.includes("999") || callerNumber.includes("VIP") ? 1 : 5;

    const caller = await callQueue.enqueueCaller(callSid, callerNumber, priority, clientId);
    const waitMs = await callQueue.getEstimatedWaitTimeMs(callSid);

    if (waitMs > 0) {
      console.log(`[Telephony] Caller ${callSid} enqueued in Twilio queue, wait: ${waitMs}ms`);
      // Keep in the CallQueueManager, do not dequeue! It will be dequeued when redirected.
      return new NextResponse(buildEnqueueTwiml("voxera_queue"), {
        headers: { "Content-Type": "text/xml" },
      });
    }

    // Accepted immediately — remove from queue, stream-handler will markCallStarted
    await callQueue.dequeueCaller(callSid);

    // Upsert, not insert: for an outbound call (single call or a campaign),
    // /api/telephony/outbound already inserted a row with this same callSid
    // (status "outbound_initiated") the moment the call was placed — Twilio
    // then hits this webhook once the recipient actually answers. A plain
    // insert would fail on the id primary key every single time, which
    // silently rejected every outbound call before this call_logs row was
    // ever reached (caught by the top-level try/catch as a generic error).
    await supabase.from("call_logs").upsert([{
      id: callSid,
      clientId,
      callerNumber,
      status: "active",
      startedAt: Date.now(),
      queueWaitMs: caller.joinedAt ? Date.now() - caller.joinedAt : 0,
    }], { onConflict: "id" });

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `https://${req.headers.get("host")}`;
    const wsUrl = `${baseUrl.replace(/^https?/, "wss")}/api/telephony/stream?callSid=${callSid}&clientId=${clientId}&caller=${encodeURIComponent(callerNumber)}${agentId ? `&agentId=${agentId}` : ""}`;

    console.log(`[Telephony] Connecting ${callSid} to stream: ${wsUrl}`);

    return new NextResponse(buildConnectTwiml(wsUrl, callSid), {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (err) {
    console.error("[Telephony] Incoming handler error:", err);
    return new NextResponse(buildRejectTwiml(), {
      headers: { "Content-Type": "text/xml" },
    });
  }
}
