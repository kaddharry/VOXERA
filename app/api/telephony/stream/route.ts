import { upgradeWebSocket } from "@vercel/functions";
import { TelephonyStreamHandler } from "@/lib/telephony/stream-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby plan hard cap — every Function (this WebSocket included) is
// killed at 300s regardless of this value. Set explicitly so the limit is
// visible here rather than implied by the platform default. Raising this
// past 300 only takes effect on Pro/Enterprise (up to 800s, or 1800s with
// the extended-duration beta) — a call longer than whatever this is set to
// gets disconnected mid-conversation.
export const maxDuration = 300;

export function GET() {
  return upgradeWebSocket((ws) => {
    console.info(JSON.stringify({ service: "telephony", event: "websocket_handshake_succeeded", timestamp: new Date().toISOString() }));
    // Twilio does not reliably forward arbitrary Stream URL query parameters.
    // The handler replaces these placeholders from start.callSid and
    // start.customParameters, which are emitted by <Stream><Parameter>.
    new TelephonyStreamHandler({ ws, callSid: "unknown", clientId: "unknown", callerNumber: "unknown" });
  });
}
