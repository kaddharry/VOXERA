import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function (this: any, opts: { baseURL: string }) {
    this.chat = { completions: { create: (...args: unknown[]) => mockCreate(opts.baseURL, ...args) } };
  }),
}));
vi.mock("../../lib/db/supabase", () => ({ supabase: { from: vi.fn() }, isSupabaseHealthy: () => true, recordSupabaseSuccess: vi.fn(), recordSupabaseFailure: vi.fn() }));

import { generateReply } from "../../lib/agent/llm";
import { __resetKeyRotatorRegistryForTests } from "../../lib/util/keys";

const stream = (text: string) => ({ async *[Symbol.asyncIterator]() { yield { choices: [{ delta: { content: text } }] }; } });
const FAST = "qwen/qwen3.6-27b";
const STRONG = "openai/gpt-oss-120b";
const TOOLS = ["check_appointment_availability", "book_appointment"];
const ORIGINAL_ENV = { ...process.env };

function ask(userLine: string, extra: Record<string, unknown> = {}) {
  return generateReply({
    system: "sys",
    // the real prompt always carries these lines in the current-turn block, which must NOT make a turn look like a booking
    user: `=== STM (recent turns) ===\n(no prior turns)\n\n=== CURRENT TURN ===\nBOOKING (live tools): book_appointment for an appointment\nTODAY: Wednesday, 25 November 2026 — resolve "tomorrow", "next Monday" etc.\nUSER: ${userLine}`,
    clientId: "c1",
    onClause: () => {},
    enabledTools: TOOLS,
    language: "auto",
    ...extra,
  });
}
const modelsUsed = () => mockCreate.mock.calls.map((c) => c[1].model);

describe("which model a turn uses", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockImplementation((_u: string, p: any) => Promise.resolve(stream("Okay. ")));
    process.env.GROQ_API_KEYS = "gsk_a,gsk_b";
    delete process.env.GROQ_API_KEYS_2; delete process.env.ZENMUX_API_KEY; delete process.env.GNANI_LLM_API_KEY;
    __resetKeyRotatorRegistryForTests();
  });
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  it("plain English chat on a tool agent uses the FAST model and sends no tools", async () => {
    await ask("I have a little pain in my legs.");
    expect(modelsUsed()).toEqual([FAST]);
    expect(mockCreate.mock.calls[0][1].tools).toBeUndefined();
  });

  it("the agent's own earlier words like 'last visit' or 'today' do not make a chat turn a booking", async () => {
    await generateReply({
      system: "sys",
      user: "=== STM (recent turns) ===\nAGENT: How have you been feeling today since your last visit?\n\n=== CURRENT TURN ===\nUSER: Not great, my legs hurt in the evening.",
      clientId: "c1", onClause: () => {}, enabledTools: TOOLS, language: "auto",
    });
    expect(modelsUsed()).toEqual([FAST]);
  });

  it("an English booking request uses the STRONG model with tools", async () => {
    await ask("Can I get an appointment tomorrow?");
    expect(modelsUsed()).toEqual([STRONG]);
    expect(mockCreate.mock.calls[0][1].tools?.length).toBeGreaterThan(0);
  });

  it("'ten o'clock works' mid-booking still counts as booking, because recent turns mention the appointment", async () => {
    await generateReply({
      system: "sys",
      user: "=== STM (recent turns) ===\nAGENT: I can book Dr. Desai at 9:00 or 10:00 tomorrow.\n\n=== CURRENT TURN ===\nUSER: Ten works.",
      clientId: "c1", onClause: () => {}, enabledTools: TOOLS, language: "auto",
    });
    expect(modelsUsed()).toEqual([STRONG]);
  });

  it("a Hindi turn uses the STRONG model", async () => {
    await ask("मुझे पैरों में दर्द है।");
    expect(modelsUsed()).toEqual([STRONG]);
  });

  it("an agent with no tools never gets tools", async () => {
    await ask("Can I get an appointment tomorrow?", { enabledTools: [] });
    expect(mockCreate.mock.calls[0][1].tools).toBeUndefined();
  });

  it("when the strong model's quota is used up, an ENGLISH turn falls back to the fast model at once", async () => {
    mockCreate.mockImplementation((_u: string, p: any) => {
      if (p.model === STRONG) return Promise.reject(Object.assign(new Error("429 Rate limit reached on tokens per day (TPD)"), { status: 429, error: { type: "tokens", code: "rate_limit_exceeded" } }));
      return Promise.resolve(stream("Okay. "));
    });
    const r = await ask("Can I get an appointment tomorrow?");
    expect(r.text).toBe("Okay.");
    expect(modelsUsed()).toContain(FAST);
    expect(r.model).toBe(FAST);
  });

  it("…but a HINDI turn never falls back to the fast model (it writes poor Hindi)", async () => {
    mockCreate.mockImplementation((_u: string, p: any) => {
      if (p.model === STRONG) return Promise.reject(Object.assign(new Error("429 tokens per day (TPD)"), { status: 429, error: { type: "tokens", code: "rate_limit_exceeded" } }));
      return Promise.resolve(stream("Okay. "));
    });
    await ask("मुझे पैरों में दर्द है।").catch(() => {});
    expect(modelsUsed().every((m) => m !== FAST)).toBe(true);
  });

  it("once every key is known to be out of quota for the strong model, later turns do not even try it", async () => {
    mockCreate.mockImplementation((_u: string, p: any) => {
      if (p.model === STRONG) return Promise.reject(Object.assign(new Error("429 tokens per day (TPD)"), { status: 429, error: { type: "tokens", code: "rate_limit_exceeded" } }));
      return Promise.resolve(stream("Okay. "));
    });
    await ask("Can I get an appointment tomorrow?"); // discovers it: tries the strong model on each key
    expect(modelsUsed().filter((m) => m === STRONG).length).toBeGreaterThan(0);
    mockCreate.mockClear();
    const t0 = Date.now();
    const r = await ask("Book me for tomorrow at ten please."); // another booking turn
    expect(modelsUsed().filter((m) => m === STRONG)).toHaveLength(0); // no wasted calls
    expect(r.model).toBe(FAST);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("a cooldown on one model does not block the other", async () => {
    mockCreate.mockImplementation((_u: string, p: any) => {
      if (p.model === STRONG) return Promise.reject(Object.assign(new Error("429 tokens per day (TPD)"), { status: 429, error: { type: "tokens", code: "rate_limit_exceeded" } }));
      return Promise.resolve(stream("Okay. "));
    });
    await ask("Can I get an appointment tomorrow?"); // strong exhausted on every key -> fast
    mockCreate.mockClear();
    const r = await ask("Just chatting."); // the fast model's keys must still be usable
    expect(r.model).toBe(FAST);
    expect(modelsUsed()).toEqual([FAST]);
  });
});
