import { createClient } from "@supabase/supabase-js";

/**
 * We use the SERVICE ROLE KEY because this code runs in a secure Node.js backend.
 * The Service Role key bypasses Row Level Security (RLS) policies, allowing the AI 
 * agent to read/write reservations without having to mock a logged-in user.
 * 
 * NOTE: NEVER expose this key to a frontend client like the browser.
 */
function getSupabaseUrl() {
  return process.env.SUPABASE_URL || "https://placeholder-project-id.supabase.co";
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "placeholder-key";
}

import { redis, redisSub } from "../redis/client";

// ─── Circuit Breaker ─────────────────────────────────────────────────────────
// Prevents cascading timeouts when Supabase is unreachable.

const CIRCUIT_BREAKER = {
  consecutiveFailures: 0,
  lastFailureAt: 0,
  /**
   * After this many consecutive failures, the circuit opens (isSupabaseHealthy()
   * returns false, and every vectorStore call short-circuits to an empty
   * result for `cooldownMs` instead of even attempting a request).
   *
   * Was 1 — the doc comment's original reasoning ("DNS ENOTFOUND is
   * deterministic, no point retrying") is true for THAT failure mode, but
   * this same threshold also fires on an ordinary transient timeoutFetch()
   * abort (see FETCH_TIMEOUT_MS above), which is NOT deterministic and
   * often would have succeeded on the very next attempt. Live call testing
   * showed a single transient abort was enough to trip the breaker and go
   * fully "amnesiac" — zero memory/knowledge retrieval — for a full 30s
   * cooldown window, silently degrading every reply in that window to "I
   * don't have that information" regardless of what was actually in the
   * knowledge base. Raised to 3: a genuine DNS/connectivity outage still
   * trips this within 3 rapid-fail requests (well under a second), while a
   * one-off network blip no longer blacks out the whole session.
   */
  threshold: 3,
  /** How long (ms) the circuit stays open before allowing a retry probe. */
  cooldownMs: 10_000,
};
// Subscribe to state change broadcasts from other instances
redisSub.subscribe("voxera:cb:state_change").catch((err: any) => {
  console.error("[Supabase CB] Failed to subscribe to state change channel:", err);
});

redisSub.on("message", (channel: string, message: string) => {
  if (channel === "voxera:cb:state_change") {
    try {
      const state = JSON.parse(message);
      CIRCUIT_BREAKER.consecutiveFailures = state.consecutiveFailures;
      CIRCUIT_BREAKER.lastFailureAt = state.lastFailureAt;
    } catch (err) {
      console.error("[Supabase CB] Failed to parse state change payload:", err);
    }
  }
});

// Pull initial state from Redis on startup asynchronously
async function syncInitialState() {
  try {
    const failures = await redis.get("voxera:cb:consecutive_failures");
    const lastFailure = await redis.get("voxera:cb:last_failure_at");
    if (failures !== null) {
      CIRCUIT_BREAKER.consecutiveFailures = parseInt(failures, 10);
    }
    if (lastFailure !== null) {
      CIRCUIT_BREAKER.lastFailureAt = parseInt(lastFailure, 10);
    }
  } catch (err) {
    console.error("[Supabase CB] Failed to sync initial circuit breaker state:", err);
  }
}
syncInitialState();

/** Returns true if Supabase is believed to be reachable. */
export function isSupabaseHealthy(): boolean {
  if (CIRCUIT_BREAKER.consecutiveFailures < CIRCUIT_BREAKER.threshold) return true;
  // Allow a retry after cooldown
  if (Date.now() - CIRCUIT_BREAKER.lastFailureAt > CIRCUIT_BREAKER.cooldownMs) return true;
  return false;
}

export function recordSupabaseSuccess(): void {
  CIRCUIT_BREAKER.consecutiveFailures = 0;
  // Asynchronously write to Redis and broadcast change
  redis.set("voxera:cb:consecutive_failures", "0").catch(() => {});
  redis.publish("voxera:cb:state_change", JSON.stringify({
    consecutiveFailures: 0,
    lastFailureAt: CIRCUIT_BREAKER.lastFailureAt,
  })).catch(() => {});
}

export function recordSupabaseFailure(): void {
  CIRCUIT_BREAKER.consecutiveFailures++;
  CIRCUIT_BREAKER.lastFailureAt = Date.now();
  
  // Asynchronously write to Redis and broadcast change
  redis.set("voxera:cb:consecutive_failures", CIRCUIT_BREAKER.consecutiveFailures.toString()).catch(() => {});
  redis.set("voxera:cb:last_failure_at", CIRCUIT_BREAKER.lastFailureAt.toString()).catch(() => {});
  redis.publish("voxera:cb:state_change", JSON.stringify({
    consecutiveFailures: CIRCUIT_BREAKER.consecutiveFailures,
    lastFailureAt: CIRCUIT_BREAKER.lastFailureAt,
  })).catch(() => {});
}

// ─── Timeout Fetch ───────────────────────────────────────────────────────────
// Wraps the global fetch with an AbortController timeout so that DNS failures
// (ENOTFOUND) don't block the pipeline for 10+ seconds.
//
// Was 2000ms (despite this comment always having said "5-second") — live
// call testing showed this was too tight for ordinary conditions: real
// vectorStore.search() calls (lib/memory/store.ts) run 3 concurrent
// Supabase RPC round trips per turn (MTM/LTM_user/LTM_client), and under
// normal network jitter that regularly exceeded 2s, producing a stream of
// "[VectorStore] Search Error: AbortError" / "[Logger] Failed to write
// session event: AbortError" — not genuine outages, just this timeout being
// too aggressive for concurrent load. Raised to 6000ms; a real DNS failure
// still fails in well under 100ms regardless of this value, so this only
// changes behavior for the "actually slow but working" case.
export const FETCH_TIMEOUT_MS = 6_000;

function timeoutFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Runs a fast connectivity probe against Supabase.
 * If the probe fails, the circuit breaker opens immediately so that
 * the first real request doesn't waste time waiting for a timeout.
 * Call this once during application startup / first request.
 */
let _probed = false;
export async function probeHealth(): Promise<boolean> {
  if (_probed) return isSupabaseHealthy();
  _probed = true;
  try {
    const { error } = await supabase.from("reservations").select("id").limit(1);
    if (error) {
      console.warn("[Supabase] Probe failed (error):", error.message);
      recordSupabaseFailure();
      return false;
    }
    recordSupabaseSuccess();
    return true;
  } catch (err: any) {
    console.warn("[Supabase] Probe failed (threw):", err.message ?? err);
    recordSupabaseFailure();
    return false;
  }
}

// ─── Client ──────────────────────────────────────────────────────────────────

export const supabase = createClient(getSupabaseUrl(), getSupabaseKey(), {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: timeoutFetch,
  },
});

// A helper for ensuring the connection is up during startup checks
export async function testConnection() {
  const { data, error } = await supabase.from("reservations").select("id").limit(1);
  if (error && error.code !== "42P01") { // 42P01 is table does not exist
    throw error;
  }
  return true;
}