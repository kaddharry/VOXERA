import { describe, it, expect, vi, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("MODEL_CACHE_DIR", () => {
  it("uses the project's .cache folder locally", async () => {
    vi.stubEnv("VERCEL", "");
    const { MODEL_CACHE_DIR } = await import("../../lib/util/model-cache");
    expect(MODEL_CACHE_DIR).toBe(path.resolve(process.cwd(), ".cache", "xenova"));
  });

  it("uses the writable temp folder on Vercel (the project folder is read-only there)", async () => {
    vi.stubEnv("VERCEL", "1");
    const { MODEL_CACHE_DIR } = await import("../../lib/util/model-cache");
    expect(MODEL_CACHE_DIR).toBe(path.join(os.tmpdir(), "xenova"));
  });
});
