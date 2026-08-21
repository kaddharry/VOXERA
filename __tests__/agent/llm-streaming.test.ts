import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function (this: any, opts: { baseURL: string }) {
    this.chat = {
      completions: {
        create: (...args: unknown[]) => mockCreate(opts.baseURL, ...args),
      },
    };
  }),
}));

const dispatchToolCallMock = vi.fn();
vi.mock("../../lib/agent/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/agent/tools")>();
  return { ...actual, dispatchToolCall: (...args: unknown[]) => dispatchToolCallMock(...args) };
});

import { generateReply } from "../../lib/agent/llm";

/** Builds an async-iterable of ChatCompletionChunk-shaped objects, matching
 * what the OpenAI SDK yields when `stream: true` is passed. */
function chunkStream(deltas: Array<Record<string, unknown>>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const delta of deltas) {
        yield { choices: [{ delta }] };
      }
    },
  };
}

function contentDeltas(text: string, chunkSize = 3) {
  const deltas: Array<{ content: string }> = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    deltas.push({ content: text.slice(i, i + chunkSize) });
  }
  return deltas;
}

const ORIGINAL_ENV = { ...process.env };

describe("generateReply — streaming mode (onClause)", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    dispatchToolCallMock.mockReset();
    process.env.GROQ_API_KEYS = "gsk_test_key";
    delete process.env.ZENMUX_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("fires onClause per sentence as content streams in, and still returns the full text", async () => {
    mockCreate.mockImplementation((_baseURL: string, params: any) => {
      expect(params.stream).toBe(true);
      return Promise.resolve(chunkStream(contentDeltas("First sentence. Second sentence! ")));
    });

    const clauses: string[] = [];
    const result = await generateReply({
      system: "sys",
      user: "hello",
      clientId: "c1",
      onClause: (c) => clauses.push(c),
    });

    expect(clauses).toEqual(["First sentence.", "Second sentence!"]);
    expect(result.text).toBe("First sentence. Second sentence!");
    expect(result.provider).toBe("groq");
  });

  it("flushes a trailing clause with no terminal punctuation once the stream ends", async () => {
    mockCreate.mockImplementation(() => Promise.resolve(chunkStream(contentDeltas("No period at the end"))));

    const clauses: string[] = [];
    await generateReply({ system: "sys", user: "hi", clientId: "c1", onClause: (c) => clauses.push(c) });

    expect(clauses).toEqual(["No period at the end"]);
  });

  it("reconstructs a streamed tool call, executes it, and only speaks the final (non-tool) completion", async () => {
    dispatchToolCallMock.mockResolvedValue(JSON.stringify({ available: true }));

    let call = 0;
    mockCreate.mockImplementation(() => {
      call++;
      if (call === 1) {
        // First streamed completion: a tool call, split across chunks the
        // way the OpenAI SDK actually streams tool_call argument deltas.
        return Promise.resolve(
          chunkStream([
            { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "check_availability", arguments: "" } }] },
            { tool_calls: [{ index: 0, function: { arguments: '{"date":"2026-10-10",' } }] },
            { tool_calls: [{ index: 0, function: { arguments: '"time":"19:00"}' } }] },
          ])
        );
      }
      // Second completion: the model's final spoken reply after seeing the tool result.
      return Promise.resolve(chunkStream(contentDeltas("Yes, that slot is available. ")));
    });

    const clauses: string[] = [];
    const result = await generateReply({
      system: "sys",
      user: "book me in",
      clientId: "c1",
      onClause: (c) => clauses.push(c),
    });

    expect(dispatchToolCallMock).toHaveBeenCalledWith(
      "check_availability",
      { date: "2026-10-10", time: "19:00" },
      "c1",
      undefined,
      undefined
    );
    // Only the final, non-tool-call completion's content should ever reach onClause.
    expect(clauses).toEqual(["Yes, that slot is available."]);
    expect(result.text).toBe("Yes, that slot is available.");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("does not fall back to a different provider once part of a reply has already been spoken", async () => {
    process.env.ZENMUX_API_KEY = "zm_test_key";
    let groqCalls = 0;
    mockCreate.mockImplementation((baseURL: string) => {
      if (baseURL.includes("groq")) {
        groqCalls++;
        return Promise.resolve({
          async *[Symbol.asyncIterator]() {
            yield { choices: [{ delta: { content: "Partial reply. " } }] };
            throw new Error("connection dropped mid-stream");
          },
        });
      }
      throw new Error("should never reach ZenMux — a clause was already spoken from Groq");
    });

    const clauses: string[] = [];
    await expect(
      generateReply({ system: "sys", user: "hello", clientId: "c1", onClause: (c) => clauses.push(c) })
    ).rejects.toThrow("connection dropped mid-stream");

    expect(clauses).toEqual(["Partial reply."]);
    expect(groqCalls).toBe(1);
  });

  it("non-streaming callers (no onClause) are completely unaffected — plain, non-streamed request", async () => {
    mockCreate.mockImplementation((_baseURL: string, params: any) => {
      expect(params.stream).toBeUndefined();
      return Promise.resolve({ choices: [{ message: { role: "assistant", content: "Plain reply", tool_calls: undefined } }] });
    });

    const result = await generateReply({ system: "sys", user: "hello", clientId: "c1" });
    expect(result.text).toBe("Plain reply");
  });
});
