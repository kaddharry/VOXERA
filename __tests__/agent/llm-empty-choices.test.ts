/**
 * Tests: BUG-O4 — resp.choices[0] accessed without a null check
 * (lib/agent/llm.ts)
 *
 * Content-filter rejections and model-overload responses can return an empty
 * choices array. `resp.choices[0].message` then threw
 * "Cannot read properties of undefined (reading 'message')", which the provider
 * loop swallowed as a generic failure — masking the real cause.
 *
 * Run: npx vitest run __tests__/agent/llm-empty-choices.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const createMock = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

// Keep the tool layer out of this test — it pulls in Supabase and the calendar.
vi.mock("../../lib/agent/tools", () => ({
  TOOLS: [],
  dispatchToolCall: vi.fn(async () => "{}"),
}));

import { generateReply } from "../../lib/agent/llm";

const ARGS = {
  system: "You are a helpful assistant.",
  user: "USER: I would like to book a table.",
  clientId: "demo",
};

describe("BUG-O4 — empty choices array from a provider", () => {
  beforeEach(() => {
    createMock.mockReset();
    // Both providers need a key or the loop skips them and never reaches the guard.
    process.env.GROQ_API_KEYS = "test-key-1";
    process.env.OPENAI_API_KEY = "test-key-2";
  });

  it("does not throw a TypeError when choices is empty", async () => {
    createMock.mockResolvedValue({ choices: [] });

    await expect(generateReply(ARGS)).resolves.toBeDefined();
  });

  it("falls through to the offline fallback rather than crashing", async () => {
    createMock.mockResolvedValue({ choices: [] });

    const reply = await generateReply(ARGS);

    expect(reply.usedLive).toBe(false);
    expect(reply.provider).toBe("offline");
    expect(reply.text.length).toBeGreaterThan(0);
  });

  it("handles a missing choices key and a null message the same way", async () => {
    for (const resp of [{}, { choices: [{}] }, { choices: [{ message: null }] }]) {
      createMock.mockResolvedValue(resp);
      await expect(generateReply(ARGS)).resolves.toMatchObject({ usedLive: false });
    }
  });

  // The discriminating test. Before the fix the offline fallback was ALREADY
  // reached — the TypeError was caught by the provider loop just like any other
  // failure — so outcome-based assertions pass either way. What was broken is
  // the diagnosis: the operator saw a TypeError about `undefined`, not the fact
  // that the provider returned zero choices.
  it("reports why the provider failed instead of a TypeError", async () => {
    createMock.mockResolvedValue({ choices: [] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await generateReply(ARGS);

    const logged = warn.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("returned no message");
    expect(logged).toContain("choices=0");
    expect(logged).not.toContain("Cannot read properties of undefined");

    warn.mockRestore();
  });

  it("does not burn retries on a deterministic empty response", async () => {
    createMock.mockResolvedValue({ choices: [] });

    await generateReply(ARGS);

    // KeyRotator only retries quota/timeout signatures. An empty-choices error
    // is neither, so each of the two providers should be attempted exactly once.
    // (If the thrown message ever contains "timeout", this jumps to 6.)
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("still returns a live reply when choices are well formed", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { role: "assistant", content: "Sure, I can help with that." } }],
    });

    const reply = await generateReply(ARGS);

    expect(reply.usedLive).toBe(true);
    expect(reply.text).toBe("Sure, I can help with that.");
  });
});
