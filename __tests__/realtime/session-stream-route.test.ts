import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The Live Calls SSE stream: on Vercel it must listen on Supabase Realtime
 * (the call can be in another Function instance), elsewhere on Redis.
 */

let transport: "supabase" | "redis" = "supabase";
let deliver: ((m: string) => void) | undefined;
const stop = vi.fn(async () => {});
vi.mock("../../lib/realtime/live-events", () => ({
  liveEventsTransport: () => transport,
  subscribeSessionEvents: vi.fn((_id: string, cb: (m: string) => void) => ((deliver = cb), stop)),
}));

const redisSubscriber = { on: vi.fn(), subscribe: vi.fn(async () => 1), unsubscribe: vi.fn(async () => 1), removeAllListeners: vi.fn() };
vi.mock("../../lib/redis/client", () => ({ createSubscriber: vi.fn(() => redisSubscriber) }));

let callRow: { clientId: string } | null = { clientId: "demo" };
vi.mock("../../lib/db/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ or: () => ({ maybeSingle: async () => ({ data: callRow }) }) }) }),
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

const { GET } = await import("../../app/api/session/[sessionId]/stream/route");
const { subscribeSessionEvents } = await import("../../lib/realtime/live-events");

async function open() {
  const controller = new AbortController();
  const res = await GET(new NextRequest("https://app.test/api/session/s1/stream", { signal: controller.signal }), {
    params: Promise.resolve({ sessionId: "s1" }),
  });
  const reader = res.body!.getReader();
  const read = async () => new TextDecoder().decode((await reader.read()).value);
  return { res, read, controller };
}

beforeEach(() => {
  vi.clearAllMocks();
  deliver = undefined;
  transport = "supabase";
  callRow = { clientId: "demo" };
});

describe("GET /api/session/[sessionId]/stream", () => {
  it("streams events received over Supabase Realtime", async () => {
    const { res, read, controller } = await open();
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(await read()).toContain('"type":"connected"');
    expect(subscribeSessionEvents).toHaveBeenCalledWith("s1", expect.any(Function));
    deliver!('{"type":"transcript","data":{"text":"hello"}}');
    expect(await read()).toBe('data: {"type":"transcript","data":{"text":"hello"}}\n\n');
    controller.abort();
    expect(stop).toHaveBeenCalled();
  });

  it("uses Redis pub/sub when not on Supabase transport", async () => {
    transport = "redis";
    const { read } = await open();
    await read();
    expect(redisSubscriber.subscribe).toHaveBeenCalledWith("session:s1");
    expect(subscribeSessionEvents).not.toHaveBeenCalled();
  });

  it("still hides another tenant's call from a viewer who isn't signed in", async () => {
    callRow = { clientId: "tenant-1" };
    const { res } = await open();
    expect(res.status).toBe(404);
    expect(subscribeSessionEvents).not.toHaveBeenCalled();
  });
});
