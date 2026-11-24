import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function (this: any, opts: { baseURL: string }) {
    this.chat = { completions: { create: (...args: unknown[]) => mockCreate(opts.baseURL, ...args) } };
  }),
}));
const dispatchToolCallMock = vi.fn();
vi.mock("../../lib/agent/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/agent/tools")>();
  return { ...actual, dispatchToolCall: (...a: unknown[]) => dispatchToolCallMock(...a) };
});

import { generateReply, offlineFallback } from "../../lib/agent/llm";
import { __resetKeyRotatorRegistryForTests } from "../../lib/util/keys";

const ORIGINAL_ENV = { ...process.env };
const turn = (u: string) => `=== CURRENT TURN ===\nUSER: ${u}`;

describe("the last-resort line when every model has failed", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    dispatchToolCallMock.mockReset();
    mockCreate.mockRejectedValue(Object.assign(new Error("429 quota"), { status: 429 }));
    process.env.GROQ_API_KEYS = "gsk_a"; delete process.env.GROQ_API_KEYS_2; delete process.env.ZENMUX_API_KEY; delete process.env.GNANI_LLM_API_KEY;
    __resetKeyRotatorRegistryForTests();
  });
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  it("never claims a booking, whatever the caller said", () => {
    for (const said of ["Can you book my appointment tomorrow?", "schedule me please", "I want to book a table"]) {
      const text = offlineFallback(turn(said));
      expect(text).not.toMatch(/locked that in|slot available|booked|confirmed|all set/i);
      expect(text).toMatch(/technical problem/i);
    }
  });

  it("never calls a tool or writes anything (it used to create a fake reservation)", async () => {
    const r = await generateReply({ system: "sys", user: turn("Can you book my appointment?"), clientId: "c1", onClause: () => {} });
    expect(r.model).toBe("offline-fallback");
    expect(r.text).toMatch(/technical problem/i);
    await new Promise((res) => setTimeout(res, 50)); // the old code fired its tool calls from a floating promise
    expect(dispatchToolCallMock).not.toHaveBeenCalled();
  });

  it("answers in the caller's own script, and is spoken", async () => {
    expect(offlineFallback(turn("मुझे पैरों में दर्द है"))).toMatch(/[ऀ-ॿ]/);
    expect(offlineFallback(turn("ਮੈਨੂੰ ਦਰਦ ਹੈ"))).toMatch(/[਀-੿]/);
    expect(offlineFallback(turn("મને દુખે છે"))).toMatch(/[઀-૿]/);
    const spoken: string[] = [];
    await generateReply({ system: "sys", user: turn("hello"), clientId: "c1", onClause: (c) => spoken.push(c) });
    expect(spoken.join(" ")).toMatch(/technical problem/i);
  });

  it("has none of the old telecom/billing scripts", () => {
    for (const said of ["my signal keeps dropping", "I was charged twice"]) {
      expect(offlineFallback(turn(said))).not.toMatch(/specialist|billing record|pattern on your line/i);
    }
  });
});
