import { describe, it, expect, vi } from "vitest";

/**
 * On Vercel the native ONNX runtime once failed to load ("libonnxruntime.so…
 * cannot open shared object file"), and because the models were imported at
 * the top of the call path, the Twilio Media Stream route itself couldn't
 * load: every call hung up after "Please hold" (Twilio 31920). The models
 * are now imported on first use, so if the runtime is ever missing again a
 * call still connects and these features fall back instead.
 */
vi.mock("@xenova/transformers", () => {
  throw new Error("libonnxruntime.so.1.14.0: cannot open shared object file: No such file or directory");
});

describe("when the ONNX runtime can't load", () => {
  it("the phone-call modules still import", async () => {
    await expect(import("../../lib/util/embed")).resolves.toBeDefined();
    await expect(import("../../lib/emotion/detect")).resolves.toBeDefined();
    await expect(import("../../lib/emotion/local-audio-detect")).resolves.toBeDefined();
    await expect(import("../../lib/warmup")).resolves.toBeDefined();
  });

  it("embeddings fall back and keep the vector store's dimension", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { embed } = await import("../../lib/util/embed");
    const v = await embed("when can I take a bath after surgery", { isQuery: true });
    expect(v).toHaveLength(384);
  });

  it("the text emotion model reports itself unavailable instead of throwing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { detectTextEmotionLocalONNX } = await import("../../lib/emotion/local-onnx-detect");
    expect(await detectTextEmotionLocalONNX("I'm worried about the surgery")).toMatchObject({ signal: null, errored: true });
  });

  it("warmup reports the failure without throwing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { warmupModels } = await import("../../lib/warmup");
    await expect(warmupModels({ includeVoiceModel: true })).resolves.toBeUndefined();
  });
});
