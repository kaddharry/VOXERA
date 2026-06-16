import { supabase } from "../db/supabase";

export type SessionEventType =
  | "utterance"
  | "emotion"
  | "memory_write"
  | "retrieval"
  | "policy"
  | "guard"
  | "llm_reply"
  | "tool_invocation"
  | "cai"
  | "escalation";

export interface SessionEvent {
  ts: number;
  sessionId: string;
  userId: string;
  clientId: string;
  type: SessionEventType;
  payload: Record<string, unknown>;
}

/**
 * Appends a single session event to the Supabase session_logs table.
 */
export async function logSessionEvent(event: SessionEvent): Promise<void> {
  const { error } = await supabase.from("session_logs").insert([event]);
  if (error) {
    console.error("[Logger] Failed to write session event to Supabase:", error);
  }
}

/**
 * Reads and parses all events for a given session from Supabase.
 */
export async function getSessionLog(sessionId: string): Promise<SessionEvent[]> {
  const { data, error } = await supabase
    .from("session_logs")
    .select("*")
    .eq("sessionId", sessionId)
    .order("ts", { ascending: true });

  if (error || !data) {
    console.error("[Logger] Failed to read session log:", error);
    return [];
  }

  return data as SessionEvent[];
}

/**
 * Helper to create a session event with common fields pre-filled.
 */
export function makeEvent(
  base: { sessionId: string; userId: string; clientId: string },
  type: SessionEventType,
  payload: Record<string, unknown>,
): SessionEvent {
  return {
    ts: Date.now(),
    sessionId: base.sessionId,
    userId: base.userId,
    clientId: base.clientId,
    type,
    payload,
  };
}
