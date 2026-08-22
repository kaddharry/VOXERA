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
import { __resetKeyRotatorRegistryForTests } from "../../lib/util/keys";

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
    // KeyRotator instances are now shared/cached across calls (see
    // getKeyRotator's doc) so a real session remembers which key already
    // failed instead of re-probing every turn — but that same persistence
    // would leak currentIndex/cooldown state between these tests if not
    // reset, since they all reuse the "GROQ_API_KEYS" env var name.
    __resetKeyRotatorRegistryForTests();
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

  it("onRawDelta fires with the running accumulated raw text on every content delta — genuine word-by-word streaming for live observability (e.g. the dashboard), independent of onClause's per-sentence cadence", async () => {
    mockCreate.mockImplementation(() => Promise.resolve(chunkStream(contentDeltas("First sentence. Second sentence!", 3))));

    const rawSnapshots: string[] = [];
    const clauses: string[] = [];
    await generateReply({
      system: "sys",
      user: "hello",
      clientId: "c1",
      onClause: (c) => clauses.push(c),
      onRawDelta: (textSoFar) => rawSnapshots.push(textSoFar),
    });

    // Fires far more often than onClause (once per raw delta, not once per
    // finished sentence) and each snapshot is the cumulative text so far.
    expect(rawSnapshots.length).toBeGreaterThan(clauses.length);
    expect(rawSnapshots[0]).toBe("Fir");
    expect(rawSnapshots[rawSnapshots.length - 1]).toBe("First sentence. Second sentence!");
    // Strictly growing — every snapshot is a superset (as a prefix) of the last.
    for (let i = 1; i < rawSnapshots.length; i++) {
      expect(rawSnapshots[i].startsWith(rawSnapshots[i - 1])).toBe(true);
    }
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

    // A short spoken recovery line is appended so the caller isn't left in
    // dead air after a mid-stream failure — see llm.ts's comment on why
    // silently propagating the error used to mean the agent just stopped
    // talking for the rest of the turn.
    expect(clauses).toEqual(["Partial reply.", "Sorry, I lost my train of thought there — could you say that again?"]);
    expect(groqCalls).toBe(1);
  });

  it("does not let KeyRotator's own internal retry regenerate and speak a second, overlapping partial reply on top of the first", async () => {
    // A single key means KeyRotator retries the SAME provider (no
    // rotation) on a retryable failure — a TimeoutError is the live-
    // observed case: the stream starts, speaks a clause, then genuinely
    // stalls past the retry budget's timeout. Before the fix, KeyRotator's
    // retry called this provider's completion a SECOND time from scratch,
    // and its (different) content got spoken right on top of the first
    // partial reply — the "Your voice was voice was cut off" garbled
    // overlap seen on a real call. Now, once anything has been spoken,
    // llm.ts fails fast instead of letting KeyRotator regenerate.
    let groqCalls = 0;
    mockCreate.mockImplementation((baseURL: string) => {
      if (baseURL.includes("groq")) {
        groqCalls++;
        return Promise.resolve({
          async *[Symbol.asyncIterator]() {
            yield { choices: [{ delta: { content: "Here is the first part of my answer. " } }] };
            throw Object.assign(new Error("stream stalled"), { name: "TimeoutError" });
          },
        });
      }
      throw new Error("should never reach a different provider — a clause was already spoken from Groq");
    });

    const clauses: string[] = [];
    await expect(
      generateReply({ system: "sys", user: "hello", clientId: "c1", onClause: (c) => clauses.push(c) })
    ).rejects.toThrow(/already spoken/i);

    // The actual completion call only ever happened ONCE — KeyRotator's
    // retry attempt was blocked before it could call the provider again.
    expect(groqCalls).toBe(1);
    expect(clauses).toEqual([
      "Here is the first part of my answer.",
      "Sorry, I lost my train of thought there — could you say that again?",
    ]);
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
