import { createHmac } from "node:crypto";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Live call events (transcript, emotion, ...) for the Live Calls page over
 * Supabase Realtime Broadcast.
 *
 * Why: on Vercel a phone call runs in one Function instance while the
 * dashboard's SSE stream (app/api/session/[sessionId]/stream) can land on
 * another. The in-memory pub/sub in lib/redis/client.ts only reaches
 * listeners in the same instance, so without a shared channel the live view
 * stays empty. Supabase Realtime is that shared channel, and the project
 * already has Supabase, so no extra service is needed.
 *
 * - Sending uses Supabase's REST broadcast endpoint: no WebSocket is kept
 *   open by the call, and a send never blocks the conversation.
 * - Receiving (the SSE route) subscribes to the channel with the server-side
 *   Supabase client; the browser never talks to Supabase Realtime directly.
 * - Channel names include an HMAC of the session id keyed with a server
 *   secret, so a public broadcast channel can't be guessed from a session id
 *   alone (the SSE route still checks the viewer owns the call).
 */

export type LiveEventsTransport = "supabase" | "redis";

/**
 * Supabase on Vercel without REDIS_URL (where the in-memory store can't reach
 * other instances); the existing Redis/in-memory pub/sub everywhere else,
 * which keeps local dev and self-hosting unchanged. LIVE_EVENTS_TRANSPORT
 * ("supabase" or "redis") overrides the choice.
 */
export function liveEventsTransport(): LiveEventsTransport {
  const forced = process.env.LIVE_EVENTS_TRANSPORT?.trim().toLowerCase();
  if (forced === "supabase" || forced === "redis") return forced;
  return process.env.VERCEL && !process.env.REDIS_URL ? "supabase" : "redis";
}

function channelSecret(): string {
  return process.env.LIVE_EVENTS_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "voxera-dev";
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
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return;
  const res = await fetch(`${url.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ messages: [{ topic: liveEventsTopic(payload.sessionId), event: LIVE_EVENT_NAME, payload }] }),
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
        console.warn(`[LiveEvents] Broadcast failed for ${sessionId}:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    q.running = false;
    if (q.pending.length === 0) queues.delete(sessionId);
  }
}

/**
 * Queues an event for broadcast and returns at once. A transcript_delta
 * carries the agent's whole reply so far, so a newer one replaces an older
 * one that hasn't been sent yet instead of sending every token.
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
 * Listens to one session's live events. Calls onMessage with each event as
 * the same JSON string the Redis path delivers; returns a function that
 * stops listening.
 */
export function subscribeSessionEvents(sessionId: string, onMessage: (message: string) => void): () => Promise<void> {
  let stopped = false;
  let channel: RealtimeChannel | undefined;
  // Loaded lazily so the emitter (imported all over the call path) doesn't
  // pull in the database client just to send events over HTTP.
  const ready = import("../db/supabase").then(({ supabase }) => {
    if (stopped) return supabase;
    channel = supabase.channel(liveEventsTopic(sessionId), { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: LIVE_EVENT_NAME }, (msg: { payload?: unknown }) => {
      if (msg?.payload) onMessage(JSON.stringify(msg.payload));
    });
    channel.subscribe((status: string, err?: Error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(`[LiveEvents] Subscription ${status} for ${sessionId}:`, err?.message ?? "");
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
