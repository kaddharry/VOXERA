import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KeyRotator, getKeyRotator, __resetKeyRotatorRegistryForTests } from "../../lib/util/keys";

const ORIGINAL_ENV = { ...process.env };

describe("KeyRotator — org-wide-looking rate limits try every configured key (cheaply) before failing", () => {
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

  it("tries every configured key (no backoff) on a TPD (tokens-per-day) error before giving up — comma-separated keys are NOT guaranteed to be the same account", async () => {
    const rotator = new KeyRotator("TEST_KEYS");
    const tpdError = Object.assign(new Error("Rate limit reached for model `x` in organization `org_abc` on tokens per day (TPD): Limit 200000, Used 197130, Requested 3324"), {
      status: 429,
      error: { message: "Rate limit reached...", type: "tokens", code: "rate_limit_exceeded" },
    });
    const operation = vi.fn().mockRejectedValue(tpdError);

    const start = Date.now();
    await expect(rotator.executeWithRotation(operation)).rejects.toThrow(/tokens per day/i);
    const elapsedMs = Date.now() - start;

    // Called once per configured key (3), not once overall — verified live
    // that a real GROQ_API_KEYS with 3 comma-separated keys had 2 on one
    // Groq account and 1 on a genuinely different one, so assuming the
    // whole list shares one quota pool was wrong. Still fast: no backoff
    // sleep between these rotations at all.
    expect(operation).toHaveBeenCalledTimes(3);
    expect(elapsedMs).toBeLessThan(200);
  });

  it("stops calling the failing key and moves on the instant a DIFFERENT key in the list succeeds", async () => {
    const rotator = new KeyRotator("TEST_KEYS");
    const operation = vi.fn()
      .mockRejectedValueOnce(groqTpmError())
      .mockResolvedValueOnce("success from a different account's key");

    const start = Date.now();
    const result = await rotator.executeWithRotation(operation);
    const elapsedMs = Date.now() - start;

    expect(result).toBe("success from a different account's key");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(elapsedMs).toBeLessThan(200);
  });

  it("still fails fast with zero backoff when every configured key genuinely shares the same exhausted account", async () => {
    const rotator = new KeyRotator("TEST_KEYS");
    const operation = vi.fn().mockRejectedValue(groqTpmError());

    const start = Date.now();
    await expect(rotator.executeWithRotation(operation)).rejects.toThrow(/tokens per minute/i);
    const elapsedMs = Date.now() - start;

    // One attempt per configured key, no more — and no backoff sleep at all
    // between them, since a same-org setup should still fail just as fast
    // as it did before this fix.
    expect(operation).toHaveBeenCalledTimes(3);
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

  it("honors a custom backoffBaseMs — real-time voice turns pass a small value so retries don't leave a live caller waiting on the default 1s/2s/4s backoff", async () => {
    const rotator = new KeyRotator("TEST_KEYS");
    const timeoutError = Object.assign(new Error("socket hang up"), { code: "ETIMEDOUT" });
    const operation = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce("success");

    const start = Date.now();
    // Tight real-time-style budget: 2 retries, 5s timeout, 300ms backoff base.
    const result = await rotator.executeWithRotation(operation, 2, 5_000, 300);
    const elapsedMs = Date.now() - start;

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
    // Should back off ~300ms (the custom base), not the 1000ms default —
    // generous upper bound to avoid flaking on slow CI, but well under the
    // 1s default that would fail this if backoffBaseMs weren't honored.
    expect(elapsedMs).toBeLessThan(800);
  });
});

describe("KeyRotator — remembers an exhausted key instead of re-probing it every call", () => {
  beforeEach(() => {
    process.env.TEST_KEYS = "key-a,key-b,key-c";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function groqTpmError() {
    return Object.assign(new Error("Rate limit reached for model `x` in organization `org_abc` on tokens per minute (TPM): Limit 8000, Used 8000, Requested 100. Please try again in 4m19.2s."), {
      status: 429,
      error: { message: "Rate limit reached...", type: "tokens", code: "rate_limit_exceeded" },
    });
  }

  it("skips a key marked on cooldown from an earlier failed call, on the very next call, without retrying it", async () => {
    const rotator = new KeyRotator("TEST_KEYS");

    // First call: key-a (index 0) hits an org-wide limit, key-b (index 1) works.
    const firstOperation = vi.fn()
      .mockRejectedValueOnce(groqTpmError())
      .mockResolvedValueOnce("success from key-b");
    const firstResult = await rotator.executeWithRotation(firstOperation);
    expect(firstResult).toBe("success from key-b");
    expect(firstOperation).toHaveBeenCalledTimes(2);

    // Second call, same rotator instance (simulating the next turn in the
    // same session): key-a is still on cooldown from the first call's
    // failure — it should be skipped entirely, going straight to key-b
    // (now current) without wasting an attempt re-discovering key-a fails.
    const secondOperation = vi.fn().mockResolvedValueOnce("success again from key-b");
    const secondResult = await rotator.executeWithRotation(secondOperation);
    expect(secondResult).toBe("success again from key-b");
    expect(secondOperation).toHaveBeenCalledTimes(1);
  });

  it("getKeyRotator returns the SAME instance across calls for the same env var — this is what makes the cooldown memory persist across turns instead of resetting every time", () => {
    __resetKeyRotatorRegistryForTests();
    process.env.ANOTHER_TEST_KEYS = "x,y";
    const a = getKeyRotator("ANOTHER_TEST_KEYS");
    const b = getKeyRotator("ANOTHER_TEST_KEYS");
    expect(a).toBe(b);
    __resetKeyRotatorRegistryForTests();
  });

  it("never lets free org-wide rotations extend the real (non-free) timeout retry budget beyond maxRetries — the exact live-observed 6-14s-turn regression", async () => {
    // 3 keys: the first two both hit an (instant, free) org-wide limit —
    // consuming the entire org-wide-rotation budget (keys.length - 1 = 2)
    // — and the third key then genuinely times out twice in a row. With
    // maxRetries=2, exactly 2 real (non-free) attempts are allowed no
    // matter how much org-wide budget was already spent; a live bug once
    // let the still-unused-looking org-wide budget keep the loop going for
    // MORE full-timeout attempts than that, which is what turned some real
    // call turns into 6-14 second waits instead of the intended ~5s cap.
    const rotator = new KeyRotator("TEST_KEYS");
    const timeoutError = Object.assign(new Error("socket hang up"), { code: "ETIMEDOUT" });
    const operation = vi.fn()
      .mockRejectedValueOnce(groqTpmError()) // key-a: free org-wide rotation 1/2
      .mockRejectedValueOnce(groqTpmError()) // key-b: free org-wide rotation 2/2 (budget now spent)
      .mockRejectedValueOnce(timeoutError) // key-c: real attempt 1/2
      .mockRejectedValueOnce(timeoutError); // (wrapped-to) key-a: real attempt 2/2 — must be the LAST call

    await expect(rotator.executeWithRotation(operation, 2, 15_000, 10)).rejects.toThrow(/exhausted all 2 retries/i);

    // Exactly 4 total calls: 2 free org-wide + 2 real timeout attempts.
    // If the old bug were still present, a 5th call would happen here.
    expect(operation).toHaveBeenCalledTimes(4);
  });
});
