import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createMigratedDb } from "../helpers/pglite-db";

/** lib/telephony/call-coordination.ts over the real SQL (PGlite), plus its behaviour when the database is down. */
let pg: Awaited<ReturnType<typeof createMigratedDb>>;
let down = false;
vi.mock("../../lib/db/supabase", () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => (down ? Promise.resolve({ data: null, error: { message: "connection refused" } }) : pg.rpc(fn, args)) },
}));
const c = await import("../../lib/telephony/call-coordination");

beforeAll(async () => {
  pg = await createMigratedDb();
});
beforeEach(() => {
  down = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("call coordination", () => {
  it("acquire → renew → release round trip, reflected in the metrics", async () => {
    expect(await c.acquireCallSlot("CA-rt", "c1")).toMatchObject({ acquired: true, alreadyHeld: false });
    expect(await c.renewCallSlot("CA-rt")).toBe(true);
    expect((await c.getTelephonyMetrics())?.activeCallCount).toBe(1);
    expect(await c.releaseCallSlot("CA-rt", "stream_closed")).toBe(true);
    expect(await c.releaseCallSlot("CA-rt", "twilio_status:completed")).toBe(false);
    expect((await c.getTelephonyMetrics())?.activeCallCount).toBe(0);
  });

  it("lets a call through (and logs) if the database is unreachable, rather than refusing a patient", async () => {
    down = true;
    expect(await c.acquireCallSlot("CA-down", "c1")).toMatchObject({ acquired: true, degraded: true });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("call_capacity_unavailable"));
  });

  it("doesn't queue anyone when the database is unreachable (they get the busy message)", async () => {
    down = true;
    expect(await c.enqueueCall("CA-q", "c1", "+1", 5)).toMatchObject({ queued: false, degraded: true });
  });
});
