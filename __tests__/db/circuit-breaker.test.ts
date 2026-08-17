/**
 * Tests: BUG-D1 / BUG-D2 — circuit breaker threshold and fetch timeout
 * (lib/db/supabase.ts)
 *
 * The breaker opened after a SINGLE failure and stayed open for 30s, so one
 * transient blip blacked out all memory (STM reads, LTM retrieval, writes) for
 * the rest of a voice call. Coupled with a 2s fetch timeout — under Supabase's
 * documented 2-5s cold start — every cold start tripped it, and the open
 * breaker then blocked the retry that would have succeeded.
 *
 * Run: npx vitest run __tests__/db/circuit-breaker.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isSupabaseHealthy,
  recordSupabaseFailure,
  recordSupabaseSuccess,
} from "../../lib/db/supabase";

describe("BUG-D1 — breaker tolerates transient failures", () => {
  beforeEach(() => {
    vi.useRealTimers();
    recordSupabaseSuccess(); // reset consecutiveFailures to 0
  });

  it("stays healthy after a single blip", () => {
    recordSupabaseFailure();

    // The regression: this was false, blacking out memory for 30s.
    expect(isSupabaseHealthy()).toBe(true);
  });

  it("stays healthy after two consecutive failures", () => {
    recordSupabaseFailure();
    recordSupabaseFailure();

    expect(isSupabaseHealthy()).toBe(true);
  });

  it("opens on the third consecutive failure", () => {
    recordSupabaseFailure();
    recordSupabaseFailure();
    recordSupabaseFailure();

    expect(isSupabaseHealthy()).toBe(false);
  });

  it("a success resets the streak", () => {
    recordSupabaseFailure();
    recordSupabaseFailure();
    recordSupabaseSuccess();
    recordSupabaseFailure();

    expect(isSupabaseHealthy()).toBe(true);
  });

  it("reopens for a retry probe once the cooldown elapses", () => {
    recordSupabaseFailure();
    recordSupabaseFailure();
    recordSupabaseFailure();
    expect(isSupabaseHealthy()).toBe(false);

    // Cooldown is 10s; jump past it.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11_000);

    expect(isSupabaseHealthy()).toBe(true);
    vi.useRealTimers();
  });
});

describe("BUG-D2 — fetch timeout clears Supabase cold starts", () => {
  it("allows a request slower than the old 2s ceiling", async () => {
    // A 3s response sits inside the documented 2-5s cold-start band. Under the
    // old 2s timeout this aborted, recorded a failure, and (with threshold 1)
    // opened the breaker. Asserted against the exported constant's effect
    // rather than the literal so the two stay coupled.
    const { FETCH_TIMEOUT_MS } = await import("../../lib/db/supabase");

    expect(FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
  });
});
