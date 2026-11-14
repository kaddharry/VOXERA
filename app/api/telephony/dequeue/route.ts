import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { buildConnectTwiml } from "../../../../lib/telephony/twilio";
import { supabase } from "../../../../lib/db/supabase";
import { acquireCallSlot, finishQueuedCall, releaseCallSlot } from "../../../../lib/telephony/call-coordination";
import { verifyTwilioWebhook } from "../../../../lib/telephony/webhook-auth";
import { publicWebhookUrl, resolvePublicBaseUrl, resolveVoiceWebSocketUrl } from "../../../../lib/telephony/urls";

export const dynamic = "force-dynamic";

/**
 * POST /api/telephony/dequeue — the <Enqueue> action URL.
 *
 * Twilio requests this when a caller leaves the queue. QueueResult "leave"
 * means queue-wait claimed a slot for them (try_dispatch_queued_call), so
 * they're connected to the agent here. Any other result (they hung up,
 * Twilio error, ...) closes their queue entry and frees anything held.
 *
 * Routing (clientId/agentId/patientId/caller) comes from the action URL the
 * incoming webhook built; Twilio signs that URL, so it can't be tampered with.
 */
export async function POST(req: NextRequest) {
  try {
    const params = Object.fromEntries(new URLSearchParams(await req.text()));
    if (!verifyTwilioWebhook(req, params).ok) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    const url = new URL(req.url);
    const callSid = params.CallSid || url.searchParams.get("callSid") || "";
    const clientId = url.searchParams.get("clientId") || "demo";
    const callerNumber = url.searchParams.get("caller") || params.From || "unknown";
    const agentId = url.searchParams.get("agentId") || undefined;
    const patientId = url.searchParams.get("patientId") || undefined;
    const queueResult = params.QueueResult || "leave";
    const queueWaitMs = params.QueueTime ? Number(params.QueueTime) * 1000 : 0;

    if (queueResult !== "leave") {
      // hangup | error | system-error | redirected | queue-full | bridged
      await finishQueuedCall(callSid, queueResult === "hangup" ? "abandoned" : "failed", `QueueResult=${queueResult}`);
      await releaseCallSlot(callSid, `queue_${queueResult}`);
      console.log(JSON.stringify({ service: "telephony", event: "queue_left_without_connect", callSid, queueResult }));
      const response = new twilio.twiml.VoiceResponse();
      response.hangup();
      return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
    }

    // queue-wait already took the slot; this is idempotent and just renews it.
    await acquireCallSlot(callSid, clientId);
    await finishQueuedCall(callSid, "dispatched");
    console.log(JSON.stringify({ service: "telephony", event: "queue_dispatched", callSid, clientId, queueWaitMs }));

    await supabase.from("call_logs").upsert([{
      id: callSid,
      clientId,
      callerNumber,
      status: "active",
      startedAt: Date.now(),
      queueWaitMs,
    }], { onConflict: "id" });

    // Media Stream identity is passed through documented <Parameter> values;
    // Twilio does not support query parameters on the Stream URL.
    const baseUrl = resolvePublicBaseUrl({ configured: process.env.VOXERA_PUBLIC_URL || process.env.NEXT_PUBLIC_BASE_URL, requestUrl: req.url });
    const wsUrl = resolveVoiceWebSocketUrl(baseUrl);
    const statusCallbackUrl = publicWebhookUrl(baseUrl, "/api/telephony/stream-status");

    return new NextResponse(
      buildConnectTwiml(wsUrl, { callSid, clientId, caller: callerNumber, ...(agentId && { agentId }), ...(patientId && { patientId }) }, statusCallbackUrl),
      { headers: { "Content-Type": "text/xml" } },
    );
  } catch (err) {
    console.error("[Telephony] Dequeue handler error:", err);
    return new NextResponse(null, { status: 500 });
  }
}
