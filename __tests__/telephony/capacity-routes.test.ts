import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Incoming webhook, queue waitUrl and queue action routes over the
 * Postgres call-coordination layer (mocked here; its SQL is tested against
 * real Postgres in __tests__/db/migration-v33.test.ts).
 */
vi.mock("../../lib/telephony/call-coordination", async () => await import("../helpers/fake-call-coordination"));
const upserts: unknown[] = [];
vi.mock("../../lib/db/supabase", () => ({
  supabase: {
    from: () => ({
      upsert: async (rows: unknown) => (upserts.push(rows), { error: null }),
      select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
    }),
  },
}));

const coord = await import("../helpers/fake-call-coordination");
const { POST: incoming } = await import("../../app/api/telephony/incoming/route");
const { POST: queueWait } = await import("../../app/api/telephony/queue-wait/route");
const { POST: dequeue } = await import("../../app/api/telephony/dequeue/route");

const req = (path: string, body: string) =>
  new NextRequest(`https://voxera.example${path}`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });

beforeEach(() => {
  vi.clearAllMocks();
  upserts.length = 0;
  process.env.VOXERA_PUBLIC_URL = "https://voxera.example";
  delete process.env.TWILIO_AUTH_TOKEN; // signature checks are covered in webhook-auth.test.ts
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("POST /api/telephony/incoming", () => {
  it("takes a slot for the CallSid and connects the stream", async () => {
    const res = await incoming(req("/api/telephony/incoming?clientId=c1&agentId=a1", "CallSid=CA1&From=%2B15551112222&To=%2B1"));
    const xml = await res.text();
    expect(coord.acquireCallSlot).toHaveBeenCalledWith("CA1", "c1");
    expect(xml).toContain('<Stream url="wss://voxera.example/api/telephony/stream"');
    expect(xml).toContain('name="agentId" value="a1"');
  });

  it("queues the caller (stored in Postgres first) when every slot is taken", async () => {
    coord.acquireCallSlot.mockResolvedValueOnce({ acquired: false, alreadyHeld: false, active: 10, max: 10 });
    const res = await incoming(req("/api/telephony/incoming?clientId=c1&agentId=a1", "CallSid=CA2&From=%2B15551112222&To=%2B1"));
    const xml = await res.text();
    expect(coord.enqueueCall).toHaveBeenCalledWith("CA2", "c1", "+15551112222", 5);
    expect(xml).toContain('waitUrl="https://voxera.example/api/telephony/queue-wait"');
    expect(xml).toContain("action=\"https://voxera.example/api/telephony/dequeue?clientId=c1&amp;caller=%2B15551112222&amp;agentId=a1\"");
    expect(xml).toContain(">voxera_queue</Enqueue>");
  });

  it("says all lines are busy when the queue is full too", async () => {
    coord.acquireCallSlot.mockResolvedValueOnce({ acquired: false, alreadyHeld: false, active: 10, max: 10 });
    coord.enqueueCall.mockResolvedValueOnce({ queued: false, position: null, reason: "queue_full" } as never);
    const xml = await (await incoming(req("/api/telephony/incoming?clientId=c1", "CallSid=CA3&From=%2B1&To=%2B1"))).text();
    expect(xml).toContain("all lines are currently busy");
    expect(xml).toContain("<Hangup/>");
  });
});

describe("POST /api/telephony/queue-wait", () => {
  it("keeps the caller on hold until they're claimed", async () => {
    const xml = await (await queueWait(req("/api/telephony/queue-wait", "CallSid=CA2"))).text();
    expect(coord.tryDispatchQueuedCall).toHaveBeenCalledWith("CA2");
    expect(xml).toContain("<Pause");
    expect(xml).not.toContain("<Leave");
  });

  it("takes them out of the queue once a slot is claimed for them", async () => {
    coord.tryDispatchQueuedCall.mockResolvedValueOnce({ dispatch: true, reason: "claimed" } as never);
    const xml = await (await queueWait(req("/api/telephony/queue-wait", "CallSid=CA2"))).text();
    expect(xml).toContain("<Leave/>");
  });
});

describe("POST /api/telephony/dequeue", () => {
  it("connects a caller who left the queue for a claimed slot", async () => {
    const xml = await (await dequeue(req("/api/telephony/dequeue?clientId=c1&caller=%2B1555&agentId=a1", "CallSid=CA2&QueueResult=leave&QueueTime=42"))).text();
    expect(coord.finishQueuedCall).toHaveBeenCalledWith("CA2", "dispatched");
    expect(xml).toContain("<Stream");
    expect(xml).toContain('name="agentId" value="a1"');
    expect(upserts[0]).toEqual([expect.objectContaining({ id: "CA2", clientId: "c1", queueWaitMs: 42000 })]);
  });

  it("closes the entry and frees anything held when the caller hung up while waiting", async () => {
    const xml = await (await dequeue(req("/api/telephony/dequeue?clientId=c1", "CallSid=CA2&QueueResult=hangup"))).text();
    expect(coord.finishQueuedCall).toHaveBeenCalledWith("CA2", "abandoned", "QueueResult=hangup");
    expect(coord.releaseCallSlot).toHaveBeenCalledWith("CA2", "queue_hangup");
    expect(xml).toContain("<Hangup/>");
  });
});
