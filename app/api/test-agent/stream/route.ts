import { upgradeWebSocket } from "@vercel/functions";
import { NextRequest } from "next/server";
import { TestAgentStreamHandler } from "@/lib/testagent/stream-handler";
import { DEMO } from "@/lib/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby plan hard cap — every Function (this WebSocket included) is
// killed at 300s regardless of this value. A browser test call is expected
// to be much shorter than a real phone call, so this is more headroom than
// this route needs, but kept consistent with app/api/telephony/stream's
// documented reasoning. See that file for what raising it requires.
export const maxDuration = 300;

/**
 * Deployed-app equivalent of server.ts's standalone WebSocketServer, for
 * the admin-only "Live Test Call" drawer (app/_components/TestAgentDrawer.tsx).
 * Unlike the Twilio route (app/api/telephony/stream/route.ts), the caller's
 * query params ARE available here — the browser constructs this URL
 * directly (no Twilio relay in between), so there's no need for the
 * Twilio route's "unknown, replaced once 'start' arrives" placeholder
 * pattern.
 */
export function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agentId") || undefined;
  const clientId = req.nextUrl.searchParams.get("clientId") || DEMO.clientId;
  const patientId = req.nextUrl.searchParams.get("patientId") || undefined;

  return upgradeWebSocket((ws) => {
    new TestAgentStreamHandler({ ws, agentId, clientId, patientId });
  });
}
