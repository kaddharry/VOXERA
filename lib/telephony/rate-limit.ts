import { supabase } from "../db/supabase";

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the caller may retry, only present when `allowed` is false. */
  retryAfterMs?: number;
}

/**
 * Fixed-window rate limiter keyed by an arbitrary string (e.g. an IP
 * address), shared by every Vercel instance: the count lives in Postgres
 * (rate_limits, sql/migration_v33.sql) and rate_limit_hit() updates it
 * atomically, so concurrent requests can't both slip under the limit.
 *
 * If the database can't be reached the request is allowed (and logged):
 * these limits stop abuse of public endpoints, and refusing every request
 * during a database blip would be worse.
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  try {
    const { data, error } = await supabase.rpc("rate_limit_hit", { p_key: key, p_limit: limit, p_window_ms: windowMs });
    if (error) throw error;
    if (data?.allowed === false) {
      return { allowed: false, retryAfterMs: Math.max(0, Number(data.retry_after_ms ?? windowMs)) };
    }
    return { allowed: true };
  } catch (err) {
    console.warn(JSON.stringify({ service: "rate_limit", event: "rate_limit_unavailable", key: key.split(":").slice(0, 2).join(":"), error: err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err) }));
    return { allowed: true };
  }
}
