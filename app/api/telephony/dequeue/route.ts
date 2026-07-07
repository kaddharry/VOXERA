import { NextRequest, NextResponse } from "next/server";
import { buildConnectTwiml } from "../../../../lib/telephony/twilio";
import { supabase } from "../../../../lib/db/supabase";

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

    // Build WebSocket URL for Twilio Media Streams
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `https://${req.headers.get("host")}`;
    const wsUrl = `${baseUrl.replace(/^https?/, "wss")}/api/telephony/stream?callSid=${callSid}&clientId=${clientId}&caller=${encodeURIComponent(callerNumber)}`;

    return new NextResponse(buildConnectTwiml(wsUrl, callSid), {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (err) {
    console.error("[Telephony] Dequeue handler error:", err);
    return new NextResponse(null, { status: 500 });
  }
}
