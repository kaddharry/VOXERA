import { CONFIG } from "../config";
import type { Utterance } from "../types";
import { supabase } from "../db/supabase";

// Hybrid STM: in-memory cache (fast reads) + Supabase persistence (survives restarts).
// Issue #5: Previously used a plain Map that was lost on server restart.

const cache = new Map<string, Utterance[]>();

export const stm = {
  async push(sessionId: string, u: Utterance, clientId?: string): Promise<void> {
    // Update cache
    const arr = cache.get(sessionId) ?? [];
    arr.push(u);
    const max = CONFIG.memory.stmMaxTurns;
    if (arr.length > max) arr.splice(0, arr.length - max);
    cache.set(sessionId, arr);

    // Persist to Supabase (fire-and-forget with error logging)
    try {
      await supabase.from("stm_sessions").upsert({
        session_id: sessionId,
        client_id: clientId ?? "unknown",
        utterances: JSON.stringify(arr),
        updated_at: Date.now(),
      });
    } catch (err) {
      console.error("[STM] Failed to persist session:", err);
    }
  },

  async get(sessionId: string): Promise<Utterance[]> {
    // Try cache first
    const cached = cache.get(sessionId);
    if (cached) return cached;

    // Fall back to database
    try {
      const { data, error } = await supabase
        .from("stm_sessions")
        .select("utterances")
        .eq("session_id", sessionId)
        .single();

      if (error || !data) return [];

      const utterances: Utterance[] = typeof data.utterances === "string"
        ? JSON.parse(data.utterances)
        : data.utterances;

      cache.set(sessionId, utterances);
      return utterances;
    } catch {
      return [];
    }
  },

  async clear(sessionId: string): Promise<void> {
    cache.delete(sessionId);
    try {
      await supabase.from("stm_sessions").delete().eq("session_id", sessionId);
    } catch (err) {
      console.error("[STM] Failed to clear session:", err);
    }
  },
};
