import { upgradeWebSocket } from "@vercel/functions";
import { TelephonyStreamHandler } from "@/lib/telephony/stream-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return upgradeWebSocket((ws) => {
    console.info(JSON.stringify({ service: "telephony", event: "websocket_handshake_succeeded", timestamp: new Date().toISOString() }));
    // Twilio does not reliably forward arbitrary Stream URL query parameters.
    // The handler replaces these placeholders from start.callSid and
    // start.customParameters, which are emitted by <Stream><Parameter>.
    new TelephonyStreamHandler({ ws, callSid: "unknown", clientId: "unknown", callerNumber: "unknown" });
  });
}
