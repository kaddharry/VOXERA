import { NextRequest, NextResponse } from "next/server";
import { buildConnectTwiml, buildEnqueueTwiml, buildRejectTwiml } from "../../../../lib/telephony/twilio";
import { acquireCallSlot, enqueueCall } from "../../../../lib/telephony/call-coordination";
import { verifyTwilioWebhook } from "../../../../lib/telephony/webhook-auth";
import { reportMissingEnvOnce } from "../../../../lib/env";
import { supabase } from "../../../../lib/db/supabase";
import { publicWebhookUrl, resolvePublicBaseUrl, resolveVoiceWebSocketUrl } from "../../../../lib/telephony/urls";

export const dynamic = "force-dynamic";

/**
 * POST /api/telephony/incoming
 *
 * Twilio calls this webhook when a phone call arrives.
 * We respond with TwiML that either:
 *   a) Opens a Media Stream WebSocket (normal path) — after atomically
 *      taking a call slot (lease) for this CallSid in Postgres
 *   b) Puts the caller in Twilio's native queue when every slot is taken
 *      (the queue entry is stored in Postgres first; see queue-wait)
 *   c) Says "all lines busy" and hangs up when the queue is full too
 * Capacity lives in telephony_settings (sql/migration_v33.sql).
 */
export async function POST(req: NextRequest) {
  reportMissingEnvOnce("telephony_incoming");
  try {
    const body = await req.text();
    const params = Object.fromEntries(new URLSearchParams(body));

    const callSid = params.CallSid || "";
    const callerNumber = params.From || "unknown";
    const toNumber = params.To || "";

    console.log(`[Telephony] Incoming call: ${callSid} from ${callerNumber} to ${toNumber}`);

    if (!verifyTwilioWebhook(req, params).ok) {
      console.warn("[Telephony] Invalid Twilio signature — rejecting request");
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Outbound calls (single "Place Outbound Call" or a bulk campaign) set
    // clientId/agentId as query params on the webhook URL they gave Twilio,
    // since `To` on an outbound call's callback is the recipient we dialed,
    // not one of our own registered numbers — the phone_numbers lookup
    // below only applies to genuine inbound calls, which never carry these.
    const queryClientId = req.nextUrl.searchParams.get("clientId");
    const queryAgentId = req.nextUrl.searchParams.get("agentId");
    // Roster patient (lib/db/patients.ts) being called, if this call came
    // from the Patients page's "Call Now" — threaded the same way as
    // agentId, only ever set on outbound calls.
    const patientId = req.nextUrl.searchParams.get("patientId") ?? undefined;

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

    const baseUrl = resolvePublicBaseUrl({ configured: process.env.VOXERA_PUBLIC_URL || process.env.NEXT_PUBLIC_BASE_URL, requestUrl: req.url });

    // Take a call slot for this CallSid (atomic + idempotent in Postgres:
    // a Twilio retry of this webhook never takes a second one). The stream
    // handler keeps renewing it; it's released when the call ends, or
    // expires on its own if the Function serving the call dies.
    const slot = await acquireCallSlot(callSid, clientId);
    if (!slot.acquired) {
      // Premium numbers jump the queue (lower = sooner).
      const priority = callerNumber.includes("999") || callerNumber.includes("VIP") ? 1 : 5;
      const queued = await enqueueCall(callSid, clientId, callerNumber, priority);
      console.log(JSON.stringify({ service: "telephony", event: queued.queued ? "call_queued" : "call_rejected_capacity", callSid, active: slot.active, max: slot.max, position: queued.position, reason: queued.reason ?? null }));
      if (!queued.queued) {
        return new NextResponse(buildRejectTwiml(), { headers: { "Content-Type": "text/xml" } });
      }
      // Who to connect them to once a slot frees up: carried on the queue's
      // action URL (Twilio signs it, see dequeue/route.ts).
      const routing = new URLSearchParams({ clientId, caller: callerNumber });
      if (agentId) routing.set("agentId", agentId);
      if (patientId) routing.set("patientId", patientId);
      return new NextResponse(
        buildEnqueueTwiml(
          "voxera_queue",
          publicWebhookUrl(baseUrl, "/api/telephony/queue-wait"),
          `${publicWebhookUrl(baseUrl, "/api/telephony/dequeue")}?${routing.toString()}`,
        ),
        { headers: { "Content-Type": "text/xml" } },
      );
    }

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
      queueWaitMs: 0,
    }], { onConflict: "id" });

    // Query params here are a best-effort fallback only (kept for direct/
    // non-Twilio WS testing) — Twilio does not reliably forward them on the
    // Media Stream connection URL. The real source of truth is the
    // <Parameter> elements below, delivered via the "start" event.
    // const wsUrl = `${baseUrl.replace(/^https?/, "wss")}/api/telephony/stream?callSid=${callSid}&clientId=${clientId}&caller=${encodeURIComponent(callerNumber)}${agentId ? `&agentId=${agentId}` : ""}${patientId ? `&patientId=${patientId}` : ""}`;

    const wsUrl = resolveVoiceWebSocketUrl(baseUrl);
    const statusCallbackUrl = publicWebhookUrl(baseUrl, "/api/telephony/stream-status");
    console.info(JSON.stringify({ service: "telephony", event: "twiml_stream_configured", timestamp: new Date().toISOString(), callSid, clientId, agentId: agentId ?? null, wsUrl, statusCallbackUrl }));

    return new NextResponse(
      buildConnectTwiml(wsUrl, { callSid, clientId, caller: callerNumber, ...(agentId && { agentId }), ...(patientId && { patientId }) }, statusCallbackUrl),
      { headers: { "Content-Type": "text/xml" } }
    );
  } catch (err) {
    console.error("[Telephony] Incoming handler error:", err);
    return new NextResponse(buildRejectTwiml(), {
      headers: { "Content-Type": "text/xml" },
    });
  }
}
