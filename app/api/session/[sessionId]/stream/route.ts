import { NextRequest } from "next/server";
import { redisSub } from "../../../../../lib/redis/client";
import { createClient } from "../../../../../lib/db/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/session/[sessionId]/stream
 *
 * Real-time Server-Sent Events (SSE) endpoint that streams session events
 * (emotion, transcript, CAI, escalation) to the Admin Dashboard.
 *
 * This endpoint is also used by the public, unauthenticated /demo page
 * (app/_components/PhoneCallDemo.tsx), so it can't require a logged-in user
 * outright. Instead: a call_logs row with clientId "demo" (the literal
 * default used by /api/telephony/outbound for public demo calls) stays open
 * to anyone who knows the sessionId, matching the existing public-demo
 * threat model. A row owned by a real tenant requires that tenant's own
 * session cookie — previously this endpoint had no check at all, so any
 * sessionId (guessed or leaked) could watch any tenant's live transcript.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const channel = `session:${sessionId}`;

  const supabase = await createClient();
  // call_logs.sessionId is the TelephonyStreamHandler-generated id when
  // present; callers fall back to call_logs.id (the Twilio CallSid) when it
  // isn't (see LiveCallMonitor.tsx), so both must be checked here.
  const { data: call } = await supabase
    .from("call_logs")
    .select("clientId")
    .or(`sessionId.eq.${sessionId},id.eq.${sessionId}`)
    .maybeSingle();

  if (call && call.clientId !== "demo") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || user.id !== call.clientId) {
      return new Response("Not found", { status: 404 });
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`)
      );

      const messageHandler = (ch: string, message: string) => {
        if (ch === channel) {
          try {
            controller.enqueue(encoder.encode(`data: ${message}\n\n`));
          } catch (err) {
            console.error(`[SSE Stream] Error enqueuing message for ${sessionId}:`, err);
          }
        }
      };

      try {
        await redisSub.subscribe(channel);
        redisSub.on("message", messageHandler);
      } catch (err) {
        console.error(`[SSE Stream] Redis subscribe error for ${sessionId}:`, err);
      }

      req.signal.addEventListener("abort", () => {
        try {
          redisSub.removeListener("message", messageHandler);
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
