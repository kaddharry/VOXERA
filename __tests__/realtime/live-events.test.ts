import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const channelMock = {
  on: vi.fn(),
  subscribe: vi.fn(),
};
vi.mock("../../lib/db/supabase", () => ({
  supabase: {
    channel: vi.fn(() => channelMock),
    removeChannel: vi.fn(async () => "ok"),
  },
}));
vi.mock("../../lib/redis/client", () => ({
  redis: { hset: vi.fn().mockResolvedValue(1), publish: vi.fn().mockResolvedValue(1) },
}));

const live = await import("../../lib/realtime/live-events");
const { emitSessionEvent } = await import("../../lib/realtime/emitter");
const { redis } = await import("../../lib/redis/client");
const { supabase } = await import("../../lib/db/supabase");

const ENV = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  live.__resetLiveEventsForTesting();
  process.env = { ...ENV, SUPABASE_URL: "https://proj.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "service-key" };
  delete process.env.VERCEL;
  delete process.env.REDIS_URL;
  delete process.env.LIVE_EVENTS_TRANSPORT;
  delete process.env.LIVE_EVENTS_SECRET;
  fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ENV };
});

const sentBodies = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
const ev = (type: string, data: Record<string, any> = {}) => ({ sessionId: "s1", type, data, timestamp: 1 });

describe("liveEventsTransport", () => {
  it("uses Supabase on Vercel without Redis, and Redis/in-memory otherwise", () => {
    expect(live.liveEventsTransport()).toBe("redis");
    process.env.VERCEL = "1";
    expect(live.liveEventsTransport()).toBe("supabase");
    process.env.REDIS_URL = "rediss://x";
    expect(live.liveEventsTransport()).toBe("redis");
    process.env.LIVE_EVENTS_TRANSPORT = "supabase";
    expect(live.liveEventsTransport()).toBe("supabase");
  });
});

describe("liveEventsTopic", () => {
  it("is stable for a session but can't be derived without the server secret", () => {
    const a = live.liveEventsTopic("s1");
    expect(a).toBe(live.liveEventsTopic("s1"));
    expect(a).toMatch(/^voxera-live:s1:[0-9a-f]{24}$/);
    expect(live.liveEventsTopic("s2")).not.toBe(a);
    process.env.SUPABASE_SERVICE_ROLE_KEY = "another-key";
    expect(live.liveEventsTopic("s1")).not.toBe(a);
  });
});

describe("broadcastSessionEvent", () => {
  it("posts to Supabase's REST broadcast endpoint with the session's topic", async () => {
    await live.broadcastSessionEvent(ev("transcript", { role: "user", text: "hello" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/realtime/v1/api/broadcast");
    expect(init.headers).toMatchObject({ apikey: "service-key", Authorization: "Bearer service-key" });
    expect(sentBodies()[0]).toEqual({
      messages: [{ topic: live.liveEventsTopic("s1"), event: "session_event", payload: ev("transcript", { role: "user", text: "hello" }) }],
    });
  });

  it("sends a session's events in order and only the latest pending reply-so-far", async () => {
    let release!: () => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => (release = () => r(new Response(null, { status: 202 })))));
    const first = live.broadcastSessionEvent(ev("transcript", { role: "user", text: "hi" }));
    void live.broadcastSessionEvent(ev("transcript_delta", { role: "agent", text: "Hel" }));
    void live.broadcastSessionEvent(ev("transcript_delta", { role: "agent", text: "Hello" }));
    void live.broadcastSessionEvent(ev("transcript_delta", { role: "agent", text: "Hello there" }));
    void live.broadcastSessionEvent(ev("emotion", { label: "calm" }));
    release();
    await first;
    expect(sentBodies().map((b) => [b.messages[0].payload.type, b.messages[0].payload.data.text ?? b.messages[0].payload.data.label])).toEqual([
      ["transcript", "hi"],
      ["transcript_delta", "Hello there"],
      ["emotion", "calm"],
    ]);
  });

  it("keeps going after a failed send", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = live.broadcastSessionEvent(ev("transcript", { text: "a" }));
    void live.broadcastSessionEvent(ev("transcript", { text: "b" }));
    await p;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
  });

  it("does nothing when Supabase isn't configured", async () => {
    delete process.env.SUPABASE_URL;
    await live.broadcastSessionEvent(ev("transcript"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("subscribeSessionEvents", () => {
  it("listens on the session's topic and hands over each event as JSON", async () => {
    const got: string[] = [];
    const stop = live.subscribeSessionEvents("s1", (m) => got.push(m));
    await vi.waitFor(() => expect(channelMock.subscribe).toHaveBeenCalled());
    expect(supabase.channel).toHaveBeenCalledWith(live.liveEventsTopic("s1"), expect.anything());
    expect(channelMock.on).toHaveBeenCalledWith("broadcast", { event: "session_event" }, expect.any(Function));
    const handler = channelMock.on.mock.calls[0][2] as (m: { payload: unknown }) => void;
    handler({ payload: ev("emotion", { label: "calm" }) });
    expect(JSON.parse(got[0])).toEqual(ev("emotion", { label: "calm" }));
    await stop();
    await stop();
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  });
});

describe("emitSessionEvent", () => {
  it("broadcasts over Supabase on Vercel instead of the per-instance pub/sub", async () => {
    process.env.VERCEL = "1";
    await emitSessionEvent("s1", "emotion", { label: "calm" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(redis.publish).not.toHaveBeenCalled();
    expect(redis.hset).toHaveBeenCalled();
  });

  it("keeps using Redis pub/sub off Vercel", async () => {
    await emitSessionEvent("s1", "emotion", { label: "calm" });
    expect(redis.publish).toHaveBeenCalledWith("session:s1", expect.stringContaining('"type":"emotion"'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
