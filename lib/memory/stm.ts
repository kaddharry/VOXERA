import { CONFIG } from "../config";
import type { Utterance } from "../types";
import { supabase } from "../db/supabase";

// Hybrid STM: in-memory cache (fast reads) + Supabase persistence (survives restarts).
// Issue #5: Previously used a plain Map that was lost on server restart.

interface CacheEntry {
  utterances: Utterance[];
  lastAccessed: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_MAX_SIZE = 200;
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour — evict sessions not accessed for 1 hour

/**
 * Evicts expired and excess entries from the in-memory cache.
 * Called automatically on each push() to keep memory bounded.
 */
function evictCache(): void {
  const now = Date.now();

  // 1. Evict expired entries (TTL)
  for (const [key, entry] of cache) {
    if (now - entry.lastAccessed > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }

  // 2. If still over capacity, evict least-recently-accessed entries (LRU)
  if (cache.size > CACHE_MAX_SIZE) {
    const sorted = [...cache.entries()].sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    const toEvict = sorted.slice(0, cache.size - CACHE_MAX_SIZE);
    for (const [key] of toEvict) {
      cache.delete(key);
    }
  }
}

// Schedule periodic cleanup of stale DB sessions (every 30 minutes)
const CLEANUP_INTERVAL_MS = 1000 * 60 * 30;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

async function cleanupStaleSessions(): Promise<void> {
  try {
    const cutoff = Date.now() - (1000 * 60 * 60 * 24); // 24 hours
    const { error } = await supabase
      .from("stm_sessions")
      .delete()
      .lt("updated_at", cutoff);

    if (error) {
      console.error("[STM] Cleanup failed:", error.message);
    }
  } catch (err) {
    // Never let cleanup crash the process
    console.error("[STM] Cleanup threw:", err);
  }
}

function ensureCleanupScheduled(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupStaleSessions, CLEANUP_INTERVAL_MS);
  // Allow the process to exit even if the timer is running
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

export const stm = {
  async push(sessionId: string, u: Utterance, clientId?: string): Promise<void> {
    ensureCleanupScheduled();
    evictCache();

    // Update cache
    const entry = cache.get(sessionId);
    const arr = entry ? entry.utterances : [];
    arr.push(u);
    const max = CONFIG.memory.stmMaxTurns;
    if (arr.length > max) arr.splice(0, arr.length - max);
    cache.set(sessionId, { utterances: arr, lastAccessed: Date.now() });

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
    const entry = cache.get(sessionId);
    if (entry) {
      entry.lastAccessed = Date.now();
      return entry.utterances;
    }

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

      cache.set(sessionId, { utterances, lastAccessed: Date.now() });
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
