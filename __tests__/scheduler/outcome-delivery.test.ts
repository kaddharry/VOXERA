import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A scheduled follow-up call's outcome must reach its task even when
 * Twilio's status callback arrives before the call_logs row exists, and
 * even when the post-call summary fails.
 */

const inserts: any[] = [];
let callLogRow: any = null;
let callLogError: any = null;

function chain(table: string) {
  const c: any = {
    insert: (rows: any) => (inserts.push({ table, rows }), Promise.resolve({ data: null, error: null })),
    update: () => c,
    select: () => c,
    eq: () => c,
    maybeSingle: async () => ({ data: table === "call_logs" ? callLogRow : null, error: table === "call_logs" ? callLogError : null }),
    single: async () => ({ data: null, error: null }),
    then: (r: any) => Promise.resolve({ data: null, error: null }).then(r),
  };
  return c;
}

vi.mock("../../lib/db/supabase", () => ({ supabase: { from: (t: string) => chain(t) } }));
vi.mock("../../lib/telephony/twilio", () => ({
  initiateOutboundCall: vi.fn(async () => ({ callSid: "CA_TEST", status: "queued" })),
}));
vi.mock("../../lib/scheduler/dispatcher", () => ({
  handleFollowUpCallOutcome: vi.fn(async () => {}),
  applyDoNotContactRequest: vi.fn(async () => {}),
  readAnsweredBy: vi.fn(async () => undefined),
}));
vi.mock("../../lib/agent/call-summary", () => ({ generateCallSummary: vi.fn() }));
vi.mock("../../lib/db/demo-requests", () => ({ updateDemoRequestStatusByCallSid: vi.fn(async () => {}) }));

const { placeOutboundCall } = await import("../../lib/telephony/outbound");
const { initiateOutboundCall } = await import("../../lib/telephony/twilio");
const { handleFollowUpCallOutcome } = await import("../../lib/scheduler/dispatcher");
const { generateCallSummary } = await import("../../lib/agent/call-summary");
const { POST } = await import("../../app/api/telephony/status/route");

function statusCallback(query: string, body: string) {
  return new NextRequest(`https://example.test/api/telephony/status${query}`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => {
  inserts.length = 0;
  callLogRow = null;
  callLogError = null;
  vi.clearAllMocks();
});

describe("placeOutboundCall", () => {
  it("puts the follow-up task id on the status callback URL and the call record", async () => {
    await placeOutboundCall({ to: "+911234567890", clientId: "c1", patientId: "p1", followUpTaskId: "task1", baseUrl: "https://example.test" });
    const { statusCallback: url } = vi.mocked(initiateOutboundCall).mock.calls[0][0] as any;
    expect(new URL(url).searchParams.get("followUpTaskId")).toBe("task1");
    expect(inserts.find((i) => i.table === "call_logs").rows[0].followUpTaskId).toBe("task1");
  });

  it("adds nothing for an ordinary (non-follow-up) call", async () => {
    await placeOutboundCall({ to: "+911234567890", clientId: "c1", baseUrl: "https://example.test" });
    const { statusCallback: url } = vi.mocked(initiateOutboundCall).mock.calls[0][0] as any;
    expect(url).toBe("https://example.test/api/telephony/status");
    expect(inserts[0].rows[0]).not.toHaveProperty("followUpTaskId");
  });
});

describe("status callback", () => {
  it("still settles the follow-up when the call record doesn't exist yet", async () => {
    callLogRow = null; // the fast failure beat the call_logs insert
    const res = await POST(statusCallback("?followUpTaskId=task1", "CallSid=CA1&CallStatus=failed"));
    expect(res.status).toBe(200);
    expect(handleFollowUpCallOutcome).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task1", twilioStatus: "failed" }));
  });

  it("still settles the follow-up when the post-call summary throws", async () => {
    callLogRow = { sessionId: "s1", clientId: "c1", patientId: "p1", followUpTaskId: "task1" };
    vi.mocked(generateCallSummary).mockRejectedValue(new Error("LLM down"));
    await POST(statusCallback("", "CallSid=CA1&CallStatus=completed&CallDuration=42"));
    await vi.waitFor(() =>
      expect(handleFollowUpCallOutcome).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task1", twilioStatus: "completed" })),
    );
  });

  it("retries a never-connected call straight away", async () => {
    callLogRow = { sessionId: null, clientId: "c1", patientId: "p1", followUpTaskId: "task1" };
    await POST(statusCallback("", "CallSid=CA1&CallStatus=no-answer"));
    expect(handleFollowUpCallOutcome).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task1", twilioStatus: "no-answer" }));
  });
});
