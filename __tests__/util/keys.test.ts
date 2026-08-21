import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KeyRotator } from "../../lib/util/keys";

const ORIGINAL_ENV = { ...process.env };

describe("KeyRotator — org-wide TPM rate limits fail fast instead of rotating", () => {
  beforeEach(() => {
    process.env.TEST_KEYS = "key-a,key-b,key-c";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function groqTpmError() {
    return Object.assign(new Error("Rate limit reached for model `x` in organization `org_abc` on tokens per minute (TPM): Limit 8000, Used 8000, Requested 100"), {
      status: 429,
      error: { message: "Rate limit reached...", type: "tokens", code: "rate_limit_exceeded" },
    });
  }

  it("throws immediately on a TPD (tokens-per-day) error too, not just TPM — same account-wide scoping", async () => {
    const rotator = new KeyRotator("TEST_KEYS");
    const tpdError = Object.assign(new Error("Rate limit reached for model `x` in organization `org_abc` on tokens per day (TPD): Limit 200000, Used 197130, Requested 3324"), {
      status: 429,
      error: { message: "Rate limit reached...", type: "tokens", code: "rate_limit_exceeded" },
    });
    const operation = vi.fn().mockRejectedValue(tpdError);

    await expect(rotator.executeWithRotation(operation)).rejects.toThrow(/tokens per day/i);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("throws immediately on a TPM error instead of rotating keys or backing off — same account/org means every key would fail identically", async () => {
    const rotator = new KeyRotator("TEST_KEYS");
    const operation = vi.fn().mockRejectedValue(groqTpmError());

    const start = Date.now();
    await expect(rotator.executeWithRotation(operation)).rejects.toThrow(/tokens per minute/i);
    const elapsedMs = Date.now() - start;

    // Only called once — no rotation, no retries, no backoff sleep.
    expect(operation).toHaveBeenCalledTimes(1);
    expect(elapsedMs).toBeLessThan(200);
  });

  it("still rotates + retries on a genuine per-key quota error (401), which IS worth trying a different key for", async () => {
    const rotator = new KeyRotator("TEST_KEYS");
    const perKeyAuthError = Object.assign(new Error("Invalid API key"), { status: 401 });
    const operation = vi.fn()
      .mockRejectedValueOnce(perKeyAuthError)
      .mockResolvedValueOnce("success");

    const result = await rotator.executeWithRotation(operation, 3, 15_000);
    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("still rotates + retries on a plain timeout (not a TPM rate limit)", async () => {
    const rotator = new KeyRotator("TEST_KEYS");
    const timeoutError = Object.assign(new Error("socket hang up"), { code: "ETIMEDOUT" });
    const operation = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce("success");

    const result = await rotator.executeWithRotation(operation, 3, 15_000);
    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
