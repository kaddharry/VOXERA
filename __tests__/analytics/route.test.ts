/**
 * Tests: Analytics API Route (app/api/analytics/route.ts)
 * Sprint 5 — Advanced operational metrics (heatmap, trends, conversion, missed, confidence, session duration)
 *
 * Run: npm run test:run
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../../app/api/analytics/route";
import { callQueue } from "../../lib/queue/manager";
import { supabase } from "../../lib/db/supabase";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockSupabaseServer = {
  auth: {
    getUser: mockGetUser,
  },
};

vi.mock("../../lib/db/server", () => ({
  createClient: vi.fn().mockImplementation(() => Promise.resolve(mockSupabaseServer)),
}));

const mockChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  then: vi.fn(),
};

vi.mock("../../lib/db/supabase", () => ({
  supabase: {
    from: vi.fn(() => mockChain),
  },
}));

vi.mock("../../lib/queue/manager", () => ({
  callQueue: {
    getMetrics: vi.fn().mockReturnValue({
      activeCallCount: 3,
      queueLength: 5,
    }),
  },
}));

// ─── Test Data Setup ──────────────────────────────────────────────────────────

const ts1 = new Date("2026-06-20T10:00:00Z").getTime();
const ts2 = new Date("2026-06-20T10:30:00Z").getTime();
const ts3 = new Date("2026-06-21T15:00:00Z").getTime();
const ts4 = new Date("2026-06-21T15:45:00Z").getTime();

const mockEvents = [
  {
    sessionId: "session-1",
    type: "emotion",
    clientId: "test-client-id",
    ts: ts1,
    payload: { label: "neutral", confidence: 0.9 },
  },
  {
    sessionId: "session-1",
    type: "emotion",
    clientId: "test-client-id",
    ts: ts2,
    payload: { label: "joy", confidence: 0.6 },
  },
  {
    sessionId: "session-1",
    type: "tool_invocation",
    clientId: "test-client-id",
    ts: ts2,
    payload: { tool: "check_availability", success: true },
  },
  {
    sessionId: "session-1",
    type: "calendar_sync",
    clientId: "test-client-id",
    ts: ts2,
    payload: { status: "synced" },
  },
  {
    sessionId: "session-2",
    type: "emotion",
    clientId: "test-client-id",
    ts: ts3,
    payload: { label: "frustration", confidence: 0.3 },
  },
  {
    sessionId: "session-2",
    type: "tool_invocation",
    clientId: "test-client-id",
    ts: ts4,
    payload: { tool: "create_booking", success: false },
  },
];

const mockBookings = [
  { status: "confirmed" },
  { status: "confirmed" },
  { status: "cancelled" },
];

const mockCallLogs = [
  { id: "call-1", status: "completed", durationMs: 120000 },
  { id: "call-2", status: "completed", durationMs: 180000 },
  { id: "call-3", status: "failed", durationMs: 0 },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 Unauthorized if no authenticated user is found", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    const response = await GET();
    expect(response.status).toBe(401);
    
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("calculates and returns all operational metrics correctly for a valid client", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "test-client-id" } } });

    // Implement conditional DB query mock resolver based on tableName
    mockChain.then.mockImplementation((onfulfilled) => {
      // Find what table we are querying by inspecting the mock call history or using a simple stateful mock
      // Since supabase.from is called sequentially: session_logs, reservations, call_logs
      // Let's resolve depending on the call count of supabase.from.
      const fromCalls = vi.mocked(supabase.from).mock.calls;
      const lastCallTable = fromCalls[fromCalls.length - 1][0];

      if (lastCallTable === "session_logs") {
        return Promise.resolve({ data: mockEvents, error: null }).then(onfulfilled);
      } else if (lastCallTable === "reservations") {
        return Promise.resolve({ data: mockBookings, error: null }).then(onfulfilled);
      } else if (lastCallTable === "call_logs") {
        return Promise.resolve({ data: mockCallLogs, error: null }).then(onfulfilled);
      }
      return Promise.resolve({ data: [], error: null }).then(onfulfilled);
    });

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();

    // 1. Basic Metrics
    expect(body.metrics.totalCalls).toBe(2);
    expect(body.metrics.totalToolInvocations).toBe(1); // 1 tool invocation has success: true
    expect(body.metrics.activeBookings).toBe(2);
    expect(body.metrics.cancelledBookings).toBe(1);
    expect(body.metrics.totalPhoneCalls).toBe(3);
    expect(body.metrics.activeCalls).toBe(3);
    expect(body.metrics.callQueueLength).toBe(5);
    expect(body.metrics.avgCallDurationMs).toBe(150000); // (120000 + 180000) / 2

    // 2. Sprint 5 Advanced Metrics
    expect(body.metrics.conversionRate).toBe(50); // 1 booking synced / 2 unique sessions * 100
    expect(body.metrics.avgSessionDurationMs).toBe(2250000); // session-1: 30m (1800000ms), session-2: 45m (2700000ms). Avg = 2250000ms.
    expect(body.metrics.missedBookings).toBe(1); // 1 failed create_booking event

    // 3. Peak Hours Heatmap
    // session-1 starts at ts1 (10:00 UTC -> local hour depends on local timezone. Since date parsing is local in the controller:
    // hour1 = new Date(ts1).getHours()
    // hour2 = new Date(ts3).getHours()
    const expectedHour1 = new Date(ts1).getHours();
    const expectedHour2 = new Date(ts3).getHours();
    
    expect(body.hourlyHeatmap[expectedHour1]).toBeGreaterThanOrEqual(1);
    expect(body.hourlyHeatmap[expectedHour2]).toBeGreaterThanOrEqual(1);

    // 4. Confidence Distribution
    // high: neutral (0.9), medium: joy (0.6), low: frustration (0.3) -> 1 of each (33% each)
    expect(body.confidenceDistribution.high).toBe(33);
    expect(body.confidenceDistribution.medium).toBe(33);
    expect(body.confidenceDistribution.low).toBe(33);

    // 5. Emotion counts
    expect(body.emotions.neutral).toBe(1);
    expect(body.emotions.joy).toBe(1);
    expect(body.emotions.frustration).toBe(1);
  });

  it("handles database errors gracefully and returns 500 status", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "test-client-id" } } });
    
    // Simulate error on session_logs query
    mockChain.then.mockImplementationOnce((onfulfilled) => {
      return Promise.resolve({ data: null, error: new Error("Database connection failure") }).then(onfulfilled);
    });

    const response = await GET();
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe("Failed to load analytics data");
  });
});
