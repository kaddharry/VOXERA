import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock local-onnx-detect so we can control its timing/availability
// independently of real model inference, to prove the router (a) short-
// circuits on a real Lexicon keyword match instead of waiting on Local ONNX,
// and (b) still falls through to Local ONNX when Lexicon has nothing.
// HF was scrapped entirely (see detect.ts) — it was the exact same model as
// Local ONNX run over the network, and a scripted accuracy eval showed it
// never once changed the selected label, so it's no longer called or mocked
// here at all.
const mockDetectTextEmotionLocalONNX = vi.fn();
vi.mock("../../lib/emotion/local-onnx-detect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/emotion/local-onnx-detect")>();
  return {
    ...actual,
    detectTextEmotionLocalONNX: (...args: unknown[]) => mockDetectTextEmotionLocalONNX(...args),
  };
});

import { detectTextEmotion, detectTextEmotionLexicon } from "../../lib/emotion/detect";

/** Default: Local ONNX unavailable, so tests that only care about
 * lexicon-default behavior aren't affected by it unless they opt in. */
const ONNX_UNAVAILABLE = { signal: null, latencyMs: 1, errored: false };

describe("Concurrent-engine emotion architecture (Lexicon + Local ONNX; HF scrapped)", () => {
  beforeEach(() => {
    mockDetectTextEmotionLocalONNX.mockReset();
    mockDetectTextEmotionLocalONNX.mockResolvedValue(ONNX_UNAVAILABLE);
  });

  it("exposes the deterministic engine as detectTextEmotionLexicon", () => {
    expect(typeof detectTextEmotionLexicon).toBe("function");
  });

  it("short-circuits on a real Lexicon keyword match without ever calling Local ONNX", async () => {
    const result = await detectTextEmotion("i am furious about this");

    expect(result.selection.engine).toBe("lexicon");
    expect(result.primary).toEqual(result.lexicon);
    expect(mockDetectTextEmotionLocalONNX).not.toHaveBeenCalled();
  });

  it("calls Local ONNX only when Lexicon found no keyword match", async () => {
    mockDetectTextEmotionLocalONNX.mockResolvedValue({
      signal: {
        label: "joy",
        intensity: 0.8,
        confidence: 0.9,
        confidenceCategory: { level: "high", range: [0.7, 1], explanation: "mock" },
        vad: { v: 0.8, a: 0.5, d: 0.3 },
        source: "text",
        at: Date.now(),
      },
      latencyMs: 8,
      errored: false,
    });

    const result = await detectTextEmotion("neutral filler text");

    expect(mockDetectTextEmotionLocalONNX).toHaveBeenCalledTimes(1);
    expect(result.selection.engine).toBe("local_onnx");
    expect(result.primary.label).toBe("joy");
  });

  it("returns Lexicon and Local ONNX results for diagnostic comparison, and an always-empty hf stub", async () => {
    mockDetectTextEmotionLocalONNX.mockResolvedValue(ONNX_UNAVAILABLE);

    const result = await detectTextEmotion("neutral filler text");

    expect(result.hf).toEqual({ signal: null, latencyMs: 0, timedOut: false });
    expect(result.localOnnx).toBeDefined();
    expect(result.lexicon).toBeDefined();
    expect(result.lexicon.label).toBeDefined();
    expect(result.lexicon.matchedKeywords).toBeDefined();
  });

  it("uses the Lexicon result when it matched a real keyword, even with Local ONNX unavailable", async () => {
    const result = await detectTextEmotion("i am furious about this");

    expect(result.selection.engine).toBe("lexicon");
    expect(result.primary).toEqual(result.lexicon);
    expect(result.selection.reason).toMatch(/matched keyword/i);
  });

  it("falls back to the Lexicon default when Local ONNX has no signal and no keyword matched, without blocking", async () => {
    mockDetectTextEmotionLocalONNX.mockResolvedValue(ONNX_UNAVAILABLE);

    const result = await detectTextEmotion("neutral filler text");

    expect(result.selection.engine).toBe("lexicon");
    expect(result.primary.label).toBe(result.lexicon.label);
  });

  it("falls back to the Lexicon default when Local ONNX throws, without blocking", async () => {
    mockDetectTextEmotionLocalONNX.mockRejectedValue(new Error("onnx runtime error"));

    const result = await detectTextEmotion("neutral filler text");

    expect(result.selection.engine).toBe("lexicon");
    expect(result.primary.label).toBe(result.lexicon.label);
  });

  it("prefers Local ONNX's signal over the lexicon default when the lexicon found no keyword match", async () => {
    mockDetectTextEmotionLocalONNX.mockResolvedValue({
      signal: {
        label: "joy",
        intensity: 0.8,
        confidence: 0.9,
        confidenceCategory: { level: "high", range: [0.7, 1], explanation: "mock" },
        vad: { v: 0.8, a: 0.5, d: 0.3 },
        source: "text",
        at: Date.now(),
      },
      latencyMs: 8,
      errored: false,
    });

    const result = await detectTextEmotion("neutral filler text");

    expect(result.selection.engine).toBe("local_onnx");
    expect(result.primary.label).toBe("joy");
  });
});
