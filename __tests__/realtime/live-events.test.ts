import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const channelMock = { on: vi.fn(), subscribe: vi.fn() };
vi.mock("../../lib/db/supabase", () => ({
  supabase: { channel: vi.fn(() => channelMock), removeChannel: vi.fn(async () => "ok") },
}));

const live = await import("../../lib/realtime/live-events");
const { supabase } = await import("../../lib/db/supabase");

const ENV = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  live.__resetLiveEventsForTesting();
  process.env = { ...ENV, SUPABASE_URL: "https://proj.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "service-key" };
  fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ENV };
});

const sentBodies = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
const ev = (type: string, data: Record<string, any> = {}) => ({ sessionId: "s1", type, data, timestamp: 1 });

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
  it("posts to Supabase's broadcast endpoint on a PRIVATE channel with the service key", async () => {
    await live.broadcastSessionEvent(ev("transcript", { role: "user", text: "hello" }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/realtime/v1/api/broadcast");
    expect(init.headers).toMatchObject({ apikey: "service-key", Authorization: "Bearer service-key" });
    expect(sentBodies()[0]).toEqual({
      messages: [{ topic: live.liveEventsTopic("s1"), event: "session_event", payload: ev("transcript", { role: "user", text: "hello" }), private: true }],
    });
  });

  it("sends a session's events in order and only the latest pending reply-so-far", async () => {
    let release!: () => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => (release = () => r(new Response(null, { status: 202 })))));
    const first = live.broadcastSessionEvent(ev("transcript", { role: "user", text: "hi" }));
    void live.broadcastSessionEvent(ev("transcript_delta", { role: "agent", text: "Hel" }));
    void live.broadcastSessionEvent(ev("transcript_delta", { role: "agent", text: "Hello" }));
    void live.broadcastSessionEvent(ev("emotion", { label: "calm" }));
    release();
    await first;
    expect(sentBodies().map((b) => [b.messages[0].payload.type, b.messages[0].payload.data.text ?? b.messages[0].payload.data.label])).toEqual([
      ["transcript", "hi"],
      ["transcript_delta", "Hello"],
      ["emotion", "calm"],
    ]);
  });

  it("keeps going after a failed send (a slow or failing Realtime never stalls the call)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = live.broadcastSessionEvent(ev("transcript", { text: "a" }));
    void live.broadcastSessionEvent(ev("transcript", { text: "b" }));
    await p;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
  });

  it("does nothing without Supabase credentials", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await live.broadcastSessionEvent(ev("transcript"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("subscribeSessionEvents", () => {
  it("joins the session's private channel and hands over each event as JSON", async () => {
    const got: string[] = [];
    const stop = live.subscribeSessionEvents("s1", (m) => got.push(m));
    await vi.waitFor(() => expect(channelMock.subscribe).toHaveBeenCalled());
    expect(supabase.channel).toHaveBeenCalledWith(live.liveEventsTopic("s1"), { config: { private: true, broadcast: { self: false } } });
    const handler = channelMock.on.mock.calls[0][2] as (m: { payload: unknown }) => void;
    handler({ payload: ev("emotion", { label: "calm" }) });
    expect(JSON.parse(got[0])).toEqual(ev("emotion", { label: "calm" }));
    await stop();
    await stop();
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  });
});
