import { NextRequest } from "next/server";
import { LocalStore } from "../../../../../lib/redis/client";
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
  // A subscriber of its own per connection rather than the shared redisSub:
  // it can be fully unsubscribed when this viewer leaves, and one viewer
  // reconnecting can never make another viewer receive messages twice.
  const subscriber = new LocalStore();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    subscriber.removeAllListeners("message");
    void subscriber.unsubscribe();
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client went away between the check above and this write.
          cleanup();
        }
      };

      // Send initial connection event
      send(`data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`);

      subscriber.on("message", (ch: string, message: string) => {
        if (ch === channel) send(`data: ${message}\n\n`);
      });
      await subscriber.subscribe(channel);

      // SSE comment line every 15s. Silences between turns (the agent
      // thinking, the caller pausing) can outlast a proxy or load
      // balancer's idle timeout; without traffic it would cut the
      // connection mid-call and any events during the reconnect gap would
      // be lost.
      heartbeat = setInterval(() => send(`: ping\n\n`), 15_000);

      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx-style proxies from buffering the stream into batches.
      "X-Accel-Buffering": "no",
    },
  });
}
