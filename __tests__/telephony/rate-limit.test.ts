import { describe, it, expect, beforeAll, vi } from "vitest";
import { createMigratedDb } from "../helpers/pglite-db";

/** checkRateLimit over the real rate_limit_hit() SQL function (PGlite). */
let pg: Awaited<ReturnType<typeof createMigratedDb>>;
let failRpc = false;
vi.mock("../../lib/db/supabase", () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => (failRpc ? Promise.resolve({ data: null, error: { message: "down" } }) : pg.rpc(fn, args)) },
}));

const { checkRateLimit } = await import("../../lib/telephony/rate-limit");

beforeAll(async () => {
  pg = await createMigratedDb();
});

describe("checkRateLimit — fixed window in Postgres", () => {
  it("allows requests under the limit", async () => {
    const key = `test:rate-limit:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect((await checkRateLimit(key, 3, 60_000)).allowed).toBe(true);
  });

  it("blocks requests once the limit is exceeded, with a retryAfterMs", async () => {
    const key = `test:rate-limit:${Math.random()}`;
    await checkRateLimit(key, 1, 60_000);
    const blocked = await checkRateLimit(key, 1, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("resets the window after it elapses", async () => {
    const key = `test:rate-limit:${Math.random()}`;
    await checkRateLimit(key, 1, 50);
    expect((await checkRateLimit(key, 1, 50)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect((await checkRateLimit(key, 1, 50)).allowed).toBe(true);
  });

  it("keeps separate windows per key", async () => {
    const a = `test:rate-limit:${Math.random()}`;
    const b = `test:rate-limit:${Math.random()}`;
    await checkRateLimit(a, 1, 60_000);
    expect((await checkRateLimit(a, 1, 60_000)).allowed).toBe(false);
    expect((await checkRateLimit(b, 1, 60_000)).allowed).toBe(true);
  });

  it("lets requests through (and logs) if the database is unreachable", async () => {
    failRpc = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect((await checkRateLimit("test:down", 1, 60_000)).allowed).toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      failRpc = false;
    }
  });
});
