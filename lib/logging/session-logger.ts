import { supabase, isSupabaseHealthy, recordSupabaseSuccess, recordSupabaseFailure } from "../db/supabase";

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
  | "escalation"
  | "calendar_sync"
  | "email_dispatch"
  | "input_guard"
  | "acoustic";

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
 * 
 * This function is designed to be called fire-and-forget (without await).
 * It checks the circuit breaker first and catches all errors internally
 * so it never blocks or crashes the calling pipeline.
 */
export async function logSessionEvent(event: SessionEvent): Promise<void> {
  // Short-circuit if Supabase is known to be unreachable
  if (!isSupabaseHealthy()) {
    return;
  }

  try {
    const { error } = await supabase.from("session_logs").insert([event]);
    if (error) {
      console.error("[Logger] Failed to write session event:", error.message);
      recordSupabaseFailure();
    } else {
      recordSupabaseSuccess();
    }
  } catch (err: any) {
    console.error("[Logger] Session event write threw:", err.message ?? err);
    recordSupabaseFailure();
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
