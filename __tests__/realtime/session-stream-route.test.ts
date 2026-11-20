import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/** The Live Calls SSE stream: tenant check first, then Supabase Realtime only. */

let deliver: ((m: string) => void) | undefined;
const stop = vi.fn(async () => {});
const subscribe = vi.fn((_id: string, cb: (m: string) => void) => ((deliver = cb), stop));
vi.mock("../../lib/realtime/live-events", () => ({ subscribeSessionEvents: (id: string, cb: (m: string) => void) => subscribe(id, cb) }));

let callRow: { id: string; clientId: string; sessionId: string | null } | null = null;
let laterSessionId: string | null = null;
vi.mock("../../lib/db/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        or: () => ({ maybeSingle: async () => ({ data: callRow }) }),
        eq: () => ({ maybeSingle: async () => ({ data: { sessionId: laterSessionId } }) }),
      }),
    }),
  },
}));
let signedInUser: { id: string } | null = null;
vi.mock("../../lib/db/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedInUser } }) } }),
}));

const { GET } = await import("../../app/api/session/[sessionId]/stream/route");

async function open(id = "tel-1") {
  const controller = new AbortController();
  const res = await GET(new NextRequest(`https://app.test/api/session/${id}/stream`, { signal: controller.signal }), { params: Promise.resolve({ sessionId: id }) });
  const reader = res.body?.getReader();
  const read = async () => new TextDecoder().decode((await reader!.read()).value);
  return { res, read, controller };
}

beforeEach(() => {
  vi.clearAllMocks();
  deliver = undefined;
  callRow = { id: "CA1", clientId: "demo", sessionId: "tel-1" };
  laterSessionId = null;
  signedInUser = null;
});

describe("GET /api/session/[sessionId]/stream", () => {
  it("streams a demo call's events from Supabase Realtime", async () => {
    const { res, read, controller } = await open();
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(await read()).toContain('"type":"connected"');
    expect(subscribe).toHaveBeenCalledWith("tel-1", expect.any(Function));
    deliver!('{"type":"transcript","data":{"text":"hello"}}');
    expect(await read()).toBe('data: {"type":"transcript","data":{"text":"hello"}}\n\n');
    controller.abort();
    expect(stop).toHaveBeenCalled();
  });

  it("refuses another tenant's call", async () => {
    callRow = { id: "CA1", clientId: "tenant-1", sessionId: "tel-1" };
    signedInUser = { id: "tenant-2" };
    const { res } = await open();
    expect(res.status).toBe(404);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("lets the owning tenant watch", async () => {
    callRow = { id: "CA1", clientId: "tenant-1", sessionId: "tel-1" };
    signedInUser = { id: "tenant-1" };
    const { res, controller } = await open();
    expect(res.status).toBe(200);
    expect(subscribe).toHaveBeenCalledWith("tel-1", expect.any(Function));
    controller.abort();
  });

  it("refuses a malformed id before querying", async () => {
    const { res } = await open("tel-1,id.neq.x");
    expect(res.status).toBe(404);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("refuses an id that matches no call", async () => {
    callRow = null;
    const { res } = await open("tel-unknown");
    expect(res.status).toBe(404);
  });

  it("resolves a CallSid to the session id once the stream has started", async () => {
    vi.useFakeTimers();
    try {
      callRow = { id: "CA1", clientId: "demo", sessionId: null };
      const { controller } = await open("CA1");
      expect(subscribe).not.toHaveBeenCalled();
      laterSessionId = "tel-9";
      await vi.advanceTimersByTimeAsync(2100);
      expect(subscribe).toHaveBeenCalledWith("tel-9", expect.any(Function));
      controller.abort();
    } finally {
      vi.useRealTimers();
    }
  });
});
