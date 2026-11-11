import { NextRequest, NextResponse } from "next/server";
import { buildConnectTwiml } from "../../../../lib/telephony/twilio";
import { supabase } from "../../../../lib/db/supabase";
import { publicWebhookUrl, resolvePublicBaseUrl, resolveVoiceWebSocketUrl } from "../../../../lib/telephony/urls";

export const dynamic = "force-dynamic";

/**
 * POST /api/telephony/dequeue
 *
 * Twilio calls this webhook when we redirect a caller out of the voxera_queue
 * to connect them to the media stream.
 */
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const callSid = url.searchParams.get("callSid") || "";
    const clientId = url.searchParams.get("clientId") || "demo";
    const callerNumber = url.searchParams.get("caller") || "unknown";

    console.log(`[Telephony] Dequeueing call: ${callSid} for client ${clientId}`);

    // Create call_log row
    await supabase.from("call_logs").insert([{
      id: callSid,
      clientId,
      callerNumber,
      status: "active",
      startedAt: Date.now(),
      queueWaitMs: 0, // wait time can be calculated if needed
    }]);

    // Media Stream identity is passed through documented <Parameter> values;
    // Twilio does not support query parameters on the Stream URL.
    const baseUrl = resolvePublicBaseUrl({ configured: process.env.VOXERA_PUBLIC_URL || process.env.NEXT_PUBLIC_BASE_URL, requestUrl: req.url });
    const wsUrl = resolveVoiceWebSocketUrl(baseUrl);
    const statusCallbackUrl = publicWebhookUrl(baseUrl, "/api/telephony/stream-status");

    return new NextResponse(buildConnectTwiml(wsUrl, { callSid, clientId, caller: callerNumber }, statusCallbackUrl), {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (err) {
    console.error("[Telephony] Dequeue handler error:", err);
    return new NextResponse(null, { status: 500 });
  }
}
