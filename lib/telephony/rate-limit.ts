import { redis } from "../redis/client";

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the caller may retry, only present when `allowed` is false. */
  retryAfterMs?: number;
}

interface WindowState {
  count: number;
  windowStart: number;
}

/**
 * Simple fixed-window rate limiter keyed by an arbitrary string (e.g. an IP
 * address). Implemented app-side with plain get/set rather than a native
 * EXPIRE/SET-EX TTL command, since the shared in-process store (see
 * lib/redis/client.ts) only implements get/set/incr/decr/hash/zset/pub-sub.
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = Date.now();
  const raw = await redis.get(key);
  let state: WindowState = raw ? JSON.parse(raw) : { count: 0, windowStart: now };

  if (now - state.windowStart >= windowMs) {
    state = { count: 0, windowStart: now };
  }

  if (state.count >= limit) {
    const retryAfterMs = windowMs - (now - state.windowStart);
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  state.count += 1;
  await redis.set(key, JSON.stringify(state));
  return { allowed: true };
}
