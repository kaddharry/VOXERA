/**
 * Tests: TelephonyStreamHandler initialisation failure cleanup
 * (lib/telephony/stream-handler.ts)
 *
 * Regression cover for the call-slot leak: init() calls
 * callQueue.markCallStarted() before awaiting deepgram.connect(), and only
 * registers the ws "close"/"error" listeners after it. If connect() rejected,
 * nothing could ever reach onCallEnded(), so voxera:active_calls was
 * incremented and never decremented — ten failures wedged the system at
 * MAX_CONCURRENT_CALLS and every subsequent call was rejected.
 *
 * Run: npx vitest run __tests__/telephony/stream-handler-init.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Module-boundary mocks (per CLAUDE.md conventions) ───────────────────────

const connectMock = vi.fn();
const closeMock = vi.fn();

vi.mock("../../lib/deepgram/live", () => ({
  DeepgramLiveWrapper: class {
    connect = connectMock;
    close = closeMock;
    sendAudio = vi.fn();
  },
}));

const updateCallLogSpy = vi.fn();

vi.mock("../../lib/db/supabase", () => ({
  supabase: {
    from: () => ({
      update: (updates: Record<string, unknown>) => {
        updateCallLogSpy(updates);
        return { eq: async () => ({ error: null }) };
      },
      select: () => ({
        eq: () => ({ single: async () => ({ data: null }) }),
      }),
    }),
  },
}));

vi.mock("../../lib/agent/orchestrator", () => ({ handleTurn: vi.fn() }));
vi.mock("../../lib/deepgram/tts", () => ({ synthesizeLinear16: vi.fn() }));
vi.mock("../../lib/memory/stm", () => ({ stm: { get: vi.fn(async () => []) } }));
vi.mock("../../lib/telephony/sms", () => ({ sendSMS: vi.fn() }));

// callQueue is intentionally NOT mocked — the active-call counter is the
// subject of these assertions. It runs against MockRedis.
import { TelephonyStreamHandler } from "../../lib/telephony/stream-handler";
import { callQueue } from "../../lib/queue/manager";

/** Minimal stand-in for the Twilio WebSocket. */
function makeFakeWs() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    listeners,
    on(event: string, cb: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(cb);
    },
    close: vi.fn(),
    send: vi.fn(),
  };
}

/** Lets the fire-and-forget init()/onInitFailed() chain settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function newHandler(ws: ReturnType<typeof makeFakeWs>) {
  return new TelephonyStreamHandler({
    ws: ws as any,
    callSid: "CA_TEST_1",
    clientId: "demo",
    callerNumber: "+15550001111",
  });
}

describe("TelephonyStreamHandler — initialisation failure", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await callQueue.reset();
    connectMock.mockReset();
    closeMock.mockReset();
  });

  it("releases the call slot when Deepgram fails to connect", async () => {
    connectMock.mockRejectedValue(new Error("DEEPGRAM_API_KEY is not set"));
    expect(await callQueue.getActiveCallCount()).toBe(0);

    newHandler(makeFakeWs());
    await flush();

    // The bug: this was 1, permanently.
    expect(await callQueue.getActiveCallCount()).toBe(0);
  });

  it("does not leave an unhandled rejection when init fails", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    connectMock.mockRejectedValue(new Error("boom"));
    newHandler(makeFakeWs());
    await flush();
    await flush();

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("marks the call failed and closes the socket", async () => {
    connectMock.mockRejectedValue(new Error("boom"));

    const ws = makeFakeWs();
    newHandler(ws);
    await flush();

    expect(updateCallLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
    expect(ws.close).toHaveBeenCalledWith(1011, "stream initialisation failed");
    expect(closeMock).toHaveBeenCalled();
  });

  it("ten consecutive failures do not exhaust the concurrency budget", async () => {
    connectMock.mockRejectedValue(new Error("boom"));

    for (let i = 0; i < 10; i++) {
      newHandler(makeFakeWs());
      await flush();
    }

    expect(await callQueue.getActiveCallCount()).toBe(0);
    expect(await callQueue.canAcceptCall()).toBe(true);
  });

  it("a successful init keeps the slot held", async () => {
    connectMock.mockResolvedValue(undefined);

    const ws = makeFakeWs();
    newHandler(ws);
    await flush();

    expect(await callQueue.getActiveCallCount()).toBe(1);
    expect(ws.close).not.toHaveBeenCalled();
    expect(ws.listeners["message"]).toHaveLength(1);
  });

  it("cleanup runs once when the socket errors and then closes", async () => {
    connectMock.mockResolvedValue(undefined);

    const ws = makeFakeWs();
    newHandler(ws);
    await flush();
    expect(await callQueue.getActiveCallCount()).toBe(1);

    // Both listeners fire on a real socket teardown; the counter must not
    // be decremented twice.
    ws.listeners["error"]?.[0]?.(new Error("socket blew up"));
    await flush();
    ws.listeners["close"]?.[0]?.();
    await flush();

    expect(await callQueue.getActiveCallCount()).toBe(0);
  });
});
