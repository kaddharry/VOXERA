import { NextRequest } from "next/server";
import { createClient } from "../../../../../lib/db/server";
import { supabase as adminDb } from "../../../../../lib/db/supabase";
import { subscribeSessionEvents } from "../../../../../lib/realtime/live-events";

export const dynamic = "force-dynamic";
// The free Vercel plan stops a Function at 300 s; the browser's EventSource
// reconnects on its own when that happens.
export const maxDuration = 300;

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
 * session cookie. An id that matches no call at all is refused too.
 *
 * Ownership is looked up with the server's own client (row-level security
 * would otherwise hide a demo call from an anonymous viewer and make the
 * check silently pass), then the viewer's session is checked against it.
 *
 * The id may be the call's session id (tel-…) or its CallSid (the dashboard
 * and the public demo use the CallSid before the session id exists); events
 * are always published under the session id, so a CallSid is resolved to it
 * — waiting for the stream's "start" event to record it if needed.
 *
 * Events come from Supabase Realtime (lib/realtime/live-events.ts) and are
 * live only; a viewer who reconnects reloads earlier turns from /replay.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  // Session ids (tel-…) and CallSids are plain [A-Za-z0-9_-]; anything else
  // is refused before it reaches the PostgREST filter below.
  if (!sessionId || !/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) return new Response("Not found", { status: 404 });

  const { data: call } = await adminDb
    .from("call_logs")
    .select('id, "clientId", "sessionId"')
    .or(`sessionId.eq.${sessionId},id.eq.${sessionId}`)
    .maybeSingle();
  if (!call) return new Response("Not found", { status: 404 });

  if (call.clientId !== "demo") {
    const userDb = await createClient();
    const {
      data: { user },
    } = await userDb.auth.getUser();
    if (!user || user.id !== call.clientId) {
      return new Response("Not found", { status: 404 });
    }
  }

  const encoder = new TextEncoder();
  let stopRealtime: (() => Promise<void>) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let resolveTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (resolveTimer) clearInterval(resolveTimer);
    if (stopRealtime) void stopRealtime();
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

      const listen = (liveSessionId: string) => {
        if (closed || stopRealtime) return;
        stopRealtime = subscribeSessionEvents(liveSessionId, (message) => send(`data: ${message}\n\n`));
      };
      if (call.sessionId) {
        listen(call.sessionId as string);
      } else {
        // Asked by CallSid before the stream's "start" event saved the
        // session id: check every 2 s (up to 2 minutes) until it appears.
        let checks = 0;
        resolveTimer = setInterval(async () => {
          checks += 1;
          const { data } = await adminDb.from("call_logs").select('"sessionId"').eq("id", call.id).maybeSingle();
          if (data?.sessionId || checks >= 60) {
            if (resolveTimer) clearInterval(resolveTimer);
            resolveTimer = undefined;
            if (data?.sessionId) listen(data.sessionId as string);
          }
        }, 2000);
      }

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
