import { describe, it, expect, vi, beforeEach } from "vitest";

let mockRows: Array<{ payload: { role?: string; text?: string } }> = [];
let mockError: any = null;

vi.mock("../../lib/db/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockImplementation(() => Promise.resolve({ data: mockRows, error: mockError })),
    })),
  },
}));

const mockGenerateReply = vi.fn();
vi.mock("../../lib/agent/llm", () => ({
  generateReply: (...args: any[]) => mockGenerateReply(...args),
}));

import { generateCallSummary } from "../../lib/agent/call-summary";

describe("generateCallSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRows = [];
    mockError = null;
  });

  it("returns null when there's no transcript for the session", async () => {
    mockRows = [];
    const result = await generateCallSummary("session-1", "client-1");
    expect(result).toBeNull();
    expect(mockGenerateReply).not.toHaveBeenCalled();
  });

  it("parses a well-formed JSON summary from the model", async () => {
    mockRows = [
      { payload: { role: "user", text: "My calf is swollen and warm." } },
      { payload: { role: "agent", text: "That sounds like it could be a blood clot — you should call back today." } },
    ];
    mockGenerateReply.mockResolvedValue({
      text: JSON.stringify({
        sentimentTrajectory: "Started calm, became concerned once the symptom was discussed.",
        flaggedConcerns: ["Reported calf swelling and warmth — matches documented DVT red flag."],
        recommendedAction: "Clinician should call back today.",
      }),
      model: "test",
      usedLive: true,
    });

    const result = await generateCallSummary("session-1", "client-1");
    expect(result).not.toBeNull();
    expect(result!.flaggedConcerns).toHaveLength(1);
    expect(result!.recommendedAction).toContain("call back today");

    // The transcript actually sent to the model includes both turns.
    const userArg = mockGenerateReply.mock.calls[0][0].user;
    expect(userArg).toContain("PATIENT: My calf is swollen and warm.");
    expect(userArg).toContain("AGENT: That sounds like it could be a blood clot");
    expect(mockGenerateReply.mock.calls[0][0].useTools).toBe(false);
  });

  it("strips a code fence around the JSON if the model adds one", async () => {
    mockRows = [{ payload: { role: "user", text: "Hi" } }];
    mockGenerateReply.mockResolvedValue({
      text: "```json\n" + JSON.stringify({
        sentimentTrajectory: "Neutral throughout.",
        flaggedConcerns: [],
        recommendedAction: "Routine follow-up.",
      }) + "\n```",
      model: "test",
      usedLive: true,
    });

    const result = await generateCallSummary("session-1", "client-1");
    expect(result).not.toBeNull();
    expect(result!.recommendedAction).toBe("Routine follow-up.");
  });

  it("returns null when the model's output isn't valid JSON", async () => {
    mockRows = [{ payload: { role: "user", text: "Hi" } }];
    mockGenerateReply.mockResolvedValue({ text: "Sorry, I can't summarize that.", model: "test", usedLive: true });

    const result = await generateCallSummary("session-1", "client-1");
    expect(result).toBeNull();
  });

  it("returns null (not throw) when generateReply itself fails", async () => {
    mockRows = [{ payload: { role: "user", text: "Hi" } }];
    mockGenerateReply.mockRejectedValue(new Error("all providers exhausted"));

    await expect(generateCallSummary("session-1", "client-1")).resolves.toBeNull();
  });
});
