import { beforeEach, describe, expect, it, vi } from "vitest";

type Op = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };
let ops: Op[] = [];
let sessionRows: unknown[] = [];
let tableMissing = false;

function builder(table: string) {
  const op: Op = { table, op: "select", filters: [] };
  const chain: any = {
    select: () => chain,
    update: (payload: unknown) => ((op.op = "update"), (op.payload = payload), chain),
    insert: (payload: unknown) => ((op.op = "insert"), (op.payload = payload), chain),
    delete: () => ((op.op = "delete"), chain),
    eq: (c: string, v: unknown) => (op.filters.push([c, v]), chain),
    in: () => chain,
    order: () => chain,
    maybeSingle: async () => (ops.push(op), { data: table === "call_logs" ? { id: "CA1", agentId: "agent-7" } : null, error: null }),
    then: (resolve: (v: unknown) => unknown) => {
      ops.push(op);
      if (table === "session_logs") return Promise.resolve({ data: sessionRows, error: null }).then(resolve);
      if (table === "call_insights" && tableMissing) return Promise.resolve({ data: null, error: { code: "42P01", message: 'relation "call_insights" does not exist' } }).then(resolve);
      return Promise.resolve({ data: null, error: null }).then(resolve);
    },
  };
  return chain;
}
vi.mock("../../lib/db/supabase", () => ({ supabase: { from: (t: string) => builder(t) } }));

const mockGenerateReply = vi.fn();
vi.mock("../../lib/agent/llm", () => ({ generateReply: (...a: unknown[]) => mockGenerateReply(...a) }));

import { analyzeCall, saveCallInsights } from "../../lib/insights/analyze-call";

const u = (id: string, text: string) => ({ type: "utterance", payload: { role: "user", utteranceId: id, text } });
const a = (text: string) => ({ type: "utterance", payload: { role: "agent", text } });
const e = (id: string, label: string, v: number) => ({ type: "emotion", payload: { utteranceId: id, label, intensity: Math.abs(v), vad: { v, a: 0, d: 0 } } });

describe("analyzeCall", () => {
  beforeEach(() => {
    ops = [];
    tableMissing = false;
    mockGenerateReply.mockReset();
    sessionRows = [
      u("1", "I'm fine thanks"), e("1", "gratitude", 0.5), a("Good. Anything else?"),
      u("2", "When can I shower?"), e("2", "confusion", -0.2), a("I don't have that information."),
    ];
  });

  it("uses the reviewer's grounded findings", async () => {
    mockGenerateReply.mockResolvedValue({
      text: JSON.stringify({
        knowledgeGaps: [{ turn: 2, question: "When can I shower?", topic: "showering after surgery" }],
        failurePoints: [{ turn: 1, agentCaused: true, whatWentWrong: "The reply brushed the patient off." }],
      }),
    });
    const insights = await analyzeCall("tel-1", "client-1");
    expect(insights?.knowledgeGaps).toEqual([expect.objectContaining({ turn: 2, topic: "showering after surgery", reviewed: true })]);
    expect(insights?.emotionalFailurePoints).toEqual([expect.objectContaining({ turn: 1, reviewed: true })]);
    expect(mockGenerateReply.mock.calls[0][0].user).toContain("Turn 1: patient went from gratitude to confusion");
  });

  it("falls back to the rules when the reviewer is unavailable or answers with something unusable", async () => {
    mockGenerateReply.mockResolvedValue({ text: "Thanks for letting me know. To make sure I help you correctly..." });
    const fromJunk = await analyzeCall("tel-1", "client-1");
    mockGenerateReply.mockRejectedValue(new Error("all providers down"));
    const fromError = await analyzeCall("tel-1", "client-1");
    for (const insights of [fromJunk, fromError]) {
      expect(insights?.knowledgeGaps).toEqual([expect.objectContaining({ turn: 2, question: "When can I shower?", reviewed: false })]);
      expect(insights?.emotionalFailurePoints).toEqual([expect.objectContaining({ turn: 1, reviewed: false })]);
    }
  });

  it("returns null for a call where the patient never spoke", async () => {
    sessionRows = [a("Hello? Is anyone there?")];
    expect(await analyzeCall("tel-1", "client-1")).toBeNull();
    expect(mockGenerateReply).not.toHaveBeenCalled();
  });
});

describe("saveCallInsights", () => {
  const insights = {
    knowledgeGaps: [{ turn: 2, question: "When can I shower?", topic: "showering", agentReply: "I don't know.", reviewed: true }],
    emotionalFailurePoints: [],
  };

  beforeEach(() => {
    ops = [];
    tableMissing = false;
  });

  it("stores findings on the call and as rows tagged with the call's agent, replacing earlier ones", async () => {
    await saveCallInsights({ callSid: "CA1", sessionId: "tel-1", clientId: "client-1", patientId: "p1", summary: { recommendedAction: "x" }, insights });
    const summaryUpdate = ops.find((o) => o.table === "call_logs" && o.op === "update");
    expect(summaryUpdate?.payload).toEqual({ summary: { recommendedAction: "x", insights } });
    const order = ops.filter((o) => o.table === "call_insights").map((o) => o.op);
    expect(order).toEqual(["delete", "insert"]);
    const rows = ops.find((o) => o.table === "call_insights" && o.op === "insert")?.payload as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      expect.objectContaining({ id: "tel-1:gap:2", kind: "knowledge_gap", topic: "showering", agentId: "agent-7", clientId: "client-1", status: "open" }),
    ]);
  });

  it("still saves on the call when the call_insights table doesn't exist yet", async () => {
    tableMissing = true;
    await saveCallInsights({ callSid: "CA1", sessionId: "tel-1", clientId: "client-1", summary: {}, insights });
    expect(ops.some((o) => o.table === "call_logs" && o.op === "update")).toBe(true);
    expect(ops.some((o) => o.table === "call_insights" && o.op === "insert")).toBe(false);
  });
});
