import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();

// Mock the `openai` SDK so no real network calls happen — mockCreate is
// keyed by which baseURL the client was constructed with, so each test can
// make Groq and ZenMux behave differently (e.g. Groq fails, ZenMux succeeds).
vi.mock("openai", () => ({
  // `generateReply` does `new OpenAI(opts)` — the mock must be a real
  // constructor function (arrow functions aren't constructible with `new`).
  default: vi.fn().mockImplementation(function (this: any, opts: { baseURL: string }) {
    this.chat = {
      completions: {
        create: (...args: unknown[]) => mockCreate(opts.baseURL, ...args),
      },
    };
  }),
}));

import { CONFIG } from "../../lib/config";
import { generateReply } from "../../lib/agent/llm";

function chatResponse(text: string) {
  return { choices: [{ message: { role: "assistant", content: text, tool_calls: undefined } }] };
}

const ORIGINAL_ENV = { ...process.env };

describe("CONFIG.llm.providers — explicit priority order", () => {
  it("tries Groq first (fastest/smallest-model provider), then ZenMux, then OpenAI", () => {
    expect(CONFIG.llm.providers.map((p) => p.name)).toEqual(["groq", "zenmux", "openai"]);
  });

  it("ZenMux reads its key from ZENMUX_API_KEY, unrelated to Groq's env var", () => {
    const zenmux = CONFIG.llm.providers.find((p) => p.name === "zenmux")!;
    const groq = CONFIG.llm.providers.find((p) => p.name === "groq")!;
    expect(zenmux.envKey).toBe("ZENMUX_API_KEY");
    expect(groq.envKey).toBe("GROQ_API_KEYS");
  });

  it("defaults Groq to a small/fast model, not the large one it used to fall back to", () => {
    const groq = CONFIG.llm.providers.find((p) => p.name === "groq")!;
    expect(groq.model).toBe("openai/gpt-oss-20b");
  });
});

describe("generateReply — Groq primary with automatic ZenMux fallback", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.ZENMUX_API_KEY = "zm_test_key";
    process.env.GROQ_API_KEYS = "gsk_test_key";
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("uses Groq and never calls ZenMux when Groq succeeds", async () => {
    mockCreate.mockImplementation((baseURL: string) => {
      if (baseURL.includes("groq")) return Promise.resolve(chatResponse("Hi from Groq"));
      throw new Error("should not reach ZenMux");
    });

    const result = await generateReply({ system: "sys", user: "hello", clientId: "c1" });

    expect(result.provider).toBe("groq");
    expect(result.text).toBe("Hi from Groq");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("falls back to ZenMux when Groq fails outright (non-retryable error)", async () => {
    mockCreate.mockImplementation((baseURL: string) => {
      if (baseURL.includes("groq")) {
        return Promise.reject(Object.assign(new Error("Bad request"), { status: 400 }));
      }
      return Promise.resolve(chatResponse("Hi from ZenMux"));
    });

    const result = await generateReply({ system: "sys", user: "hello", clientId: "c1" });

    expect(result.provider).toBe("zenmux");
    expect(result.text).toBe("Hi from ZenMux");
    // First call must have been Groq (priority order respected).
    expect(mockCreate.mock.calls[0][0]).toContain("groq");
  });

  it("falls back to ZenMux when Groq is unset entirely", async () => {
    delete process.env.GROQ_API_KEYS;
    mockCreate.mockImplementation((baseURL: string) => {
      if (baseURL.includes("groq")) throw new Error("should not call groq with no key");
      return Promise.resolve(chatResponse("Hi from ZenMux"));
    });

    const result = await generateReply({ system: "sys", user: "hello", clientId: "c1" });

    expect(result.provider).toBe("zenmux");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toContain("zenmux");
  });
});
