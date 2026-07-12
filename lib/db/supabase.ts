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
  /** After this many consecutive failures, the circuit opens.
   *  Set to 1 because DNS ENOTFOUND is deterministic — if the host
   *  can't be resolved once, it won't resolve on the next call either. */
  threshold: 1,
  /** How long (ms) the circuit stays open before allowing a retry probe. */
  cooldownMs: 30_000,
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
// Wraps the global fetch with a 5-second AbortController timeout so that
// DNS failures (ENOTFOUND) don't block the pipeline for 10+ seconds.

const FETCH_TIMEOUT_MS = 2_000;

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
