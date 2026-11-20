import { createHmac } from "node:crypto";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Live call events (transcript, emotion, ...) for the Live Calls page, over
 * Supabase Realtime Broadcast — the only live-event transport.
 *
 *   call (TelephonyStreamHandler / orchestrator) → emitSessionEvent()
 *     → broadcastSessionEvent(): Supabase REST broadcast, PRIVATE channel
 *     → subscribeSessionEvents() in the authorised SSE route
 *       (app/api/session/[sessionId]/stream) → browser EventSource
 *
 * Why: a call runs in one Vercel Function instance while a viewer's SSE
 * stream can land in another, so events have to cross instances.
 *
 * Security: channels are PRIVATE. Supabase authorises private channels with
 * RLS on realtime.messages; only the service-role key (server only) is used
 * to send and listen, it bypasses RLS, and no policy grants anon or
 * signed-in users access (sql/migration_v33.sql). So a browser can't join a
 * channel even if it learned the name; viewers only get events through the
 * SSE route, which checks they own the call first. The channel name also
 * carries an HMAC of the session id as a second layer.
 *
 * Broadcasts are transient: a viewer who reconnects reloads the call so far
 * from Postgres (/api/session/[sessionId]/replay, session_logs).
 */

function channelSecret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || "voxera-dev-only";
}

/** The Realtime channel (topic) for one session's live events. */
export function liveEventsTopic(sessionId: string): string {
  const tag = createHmac("sha256", channelSecret()).update(sessionId).digest("hex").slice(0, 24);
  return `voxera-live:${sessionId}:${tag}`;
}

export const LIVE_EVENT_NAME = "session_event";

interface LivePayload {
  sessionId: string;
  type: string;
  data: Record<string, any>;
  timestamp: number;
}

// One send queue per session, so events arrive in the order they happened.
const queues = new Map<string, { pending: LivePayload[]; running: boolean }>();

async function post(payload: LivePayload): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return; // logged once by the env check; nothing to send to
  const res = await fetch(`${url.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      messages: [{ topic: liveEventsTopic(payload.sessionId), event: LIVE_EVENT_NAME, payload, private: true }],
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`broadcast returned ${res.status}`);
}

async function drain(sessionId: string): Promise<void> {
  const q = queues.get(sessionId);
  if (!q || q.running) return;
  q.running = true;
  try {
    while (q.pending.length > 0) {
      const next = q.pending.shift()!;
      try {
        await post(next);
      } catch (err) {
        console.warn(JSON.stringify({ service: "live_events", event: "broadcast_failed", sessionId, type: next.type, error: err instanceof Error ? err.message : String(err) }));
      }
    }
  } finally {
    q.running = false;
    if (q.pending.length === 0) queues.delete(sessionId);
  }
}

/**
 * Queues an event for broadcast and returns at once (the call never waits
 * on it). A transcript_delta carries the agent's whole reply so far, so a
 * newer one replaces an older one that hasn't been sent yet.
 */
export function broadcastSessionEvent(payload: LivePayload): Promise<void> {
  const q = queues.get(payload.sessionId) ?? { pending: [], running: false };
  queues.set(payload.sessionId, q);
  const last = q.pending[q.pending.length - 1];
  if (payload.type === "transcript_delta" && last?.type === "transcript_delta" && last.data?.role === payload.data?.role) {
    q.pending[q.pending.length - 1] = payload;
  } else {
    q.pending.push(payload);
  }
  return drain(payload.sessionId);
}

/**
 * Listens to one session's live events with the server's Supabase client.
 * Calls onMessage with each event as a JSON string; returns a function that
 * stops listening. Only call this after checking the viewer may see the call.
 */
export function subscribeSessionEvents(sessionId: string, onMessage: (message: string) => void): () => Promise<void> {
  let stopped = false;
  let channel: RealtimeChannel | undefined;
  // Loaded lazily so the emitter (imported all over the call path) doesn't
  // pull in the database client just to send events over HTTP.
  const ready = import("../db/supabase").then(({ supabase }) => {
    if (stopped) return supabase;
    channel = supabase.channel(liveEventsTopic(sessionId), { config: { private: true, broadcast: { self: false } } });
    channel.on("broadcast", { event: LIVE_EVENT_NAME }, (msg: { payload?: unknown }) => {
      if (msg?.payload) onMessage(JSON.stringify(msg.payload));
    });
    channel.subscribe((status: string, err?: Error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(JSON.stringify({ service: "live_events", event: "subscribe_failed", sessionId, status, error: err?.message ?? null }));
      }
    });
    return supabase;
  });
  return async () => {
    if (stopped) return;
    stopped = true;
    const supabase = await ready;
    if (channel) await supabase.removeChannel(channel).catch(() => {});
  };
}

export function __resetLiveEventsForTesting(): void {
  queues.clear();
}
