import { broadcastSessionEvent } from "./live-events";

export interface SessionEventPayload {
  sessionId: string;
  type: "emotion" | "transcript" | "transcript_delta" | "cai" | "acoustic" | "policy" | "escalation" | "emotion_diagnostic" | "retrieval";
  data: Record<string, any>;
  timestamp: number;
}

/**
 * Sends a live session event to the Live Calls dashboard over Supabase
 * Realtime (lib/realtime/live-events.ts). Fire-and-forget: the send runs in
 * the background and never delays the call.
 *
 * This is only the live feed. The durable record of a call (transcript,
 * emotion per turn, retrievals) is written to Postgres by the session logger
 * (lib/logging/session-logger.ts), which the dashboard reloads on reconnect.
 */
export async function emitSessionEvent(
  sessionId: string,
  type: SessionEventPayload["type"],
  data: Record<string, any>
): Promise<void> {
  const payload: SessionEventPayload = { sessionId, type, data, timestamp: Date.now() };
  void broadcastSessionEvent(payload).catch((err) =>
    console.error(`[Emitter] Failed to emit session event for ${sessionId}:`, err),
  );
}
