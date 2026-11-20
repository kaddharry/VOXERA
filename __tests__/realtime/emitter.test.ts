import { describe, it, expect, vi, beforeEach } from "vitest";

const broadcast = vi.fn(async (_payload: unknown) => {});
vi.mock("../../lib/realtime/live-events", () => ({ broadcastSessionEvent: (p: unknown) => broadcast(p) }));

const { emitSessionEvent } = await import("../../lib/realtime/emitter");

describe("emitSessionEvent", () => {
  beforeEach(() => broadcast.mockClear());

  it("hands every event to Supabase Realtime, timestamped", async () => {
    await emitSessionEvent("s1", "emotion", { label: "anger", intensity: 0.8 });
    expect(broadcast).toHaveBeenCalledWith({ sessionId: "s1", type: "emotion", data: { label: "anger", intensity: 0.8 }, timestamp: expect.any(Number) });
  });

  it("never throws or waits on a failed broadcast", async () => {
    broadcast.mockRejectedValueOnce(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(emitSessionEvent("s1", "transcript", { text: "hi" })).resolves.toBeUndefined();
    await vi.waitFor(() => expect(err).toHaveBeenCalled());
  });
});
