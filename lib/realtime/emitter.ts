import { redis, redisSub } from "../redis/client";

export interface SessionEventPayload {
  sessionId: string;
  type: "emotion" | "transcript" | "transcript_delta" | "cai" | "acoustic" | "policy" | "escalation" | "emotion_diagnostic" | "retrieval";
  data: Record<string, any>;
  timestamp: number;
}

/**
 * Publishes a session event to Redis Pub/Sub so that real-time SSE endpoints
 * can push live updates to the Admin Dashboard.
 */
export async function emitSessionEvent(
  sessionId: string,
  type: SessionEventPayload["type"],
  data: Record<string, any>
): Promise<void> {
  const payload: SessionEventPayload = {
    sessionId,
    type,
    data,
    timestamp: Date.now(),
  };

  const channel = `session:${sessionId}`;
  const message = JSON.stringify(payload);

  try {
    // Also update a hash of the current active session state in Redis
    if (type === "emotion") {
      await redis.hset(`session_state:${sessionId}`, "last_emotion", JSON.stringify(data));
      await redis.hset(`session_state:${sessionId}`, "updated_at", payload.timestamp.toString());
    } else if (type === "cai") {
      await redis.hset(`session_state:${sessionId}`, "last_cai", JSON.stringify(data));
    } else if (type === "transcript") {
      await redis.hset(`session_state:${sessionId}`, "last_transcript", JSON.stringify(data));
    }

    // Publish to the specific session channel AND the global active calls channel
    await redis.publish(channel, message);
    await redis.publish("active_calls_events", message);
  } catch (err) {
    console.error(`[Emitter] Failed to emit session event for ${sessionId}:`, err);
  }
}
