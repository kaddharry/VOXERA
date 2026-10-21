import { experimental_upgradeWebSocket } from "@vercel/functions";
import { TelephonyStreamHandler } from "@/lib/telephony/stream-handler";

export function GET() {
    return experimental_upgradeWebSocket((ws) => {
        console.log("[TelephonyStream] Twilio WebSocket connected");

        new TelephonyStreamHandler({
            ws,
            callSid: "unknown",
            clientId: "demo",
            callerNumber: "unknown",
        });
    });
}