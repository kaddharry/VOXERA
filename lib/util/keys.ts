/**
 * API Key Rotation Manager with Resilient Retry Logic
 *
 * Issue #7: Enhanced with timeout handling, exponential backoff,
 * and retry on transient server errors (500/502/503).
 *
 * Allows supplying multiple API keys (comma-separated) via environment variables.
 * When a key hits a rate limit (429) or runs out of credits (401/403), the rotator
 * switches to the next available key automatically.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(Object.assign(new Error(`Request timed out after ${ms}ms`), { name: "TimeoutError" })),
        ms,
      ),
    ),
  ]);
}

export class KeyRotator {
  private keys: string[];
  private currentIndex: number = 0;
  private name: string;

  constructor(envVarName: string) {
    this.name = envVarName;
    const raw = process.env[envVarName] ?? "";
    this.keys = raw
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (this.keys.length === 0) {
      console.warn(`[KeyRotator] No keys found in process.env.${envVarName}`);
    } else {
      console.log(
        `[KeyRotator] Initialized ${this.name} with ${this.keys.length} key(s).`,
      );
    }
  }

  /**
   * Returns the currently active API key.
   * If no keys are configured, returns null.
   */
  public getKey(): string | null {
    if (this.keys.length === 0) return null;
    return this.keys[this.currentIndex];
  }

  /**
   * Marks the current key as exhausted/rate-limited and rotates to the next one.
   * Returns true if there are more keys to try, false if all keys have been exhausted.
   */
  public rotate(): boolean {
    if (this.keys.length <= 1) return false;

    console.warn(
      `[KeyRotator] Rotating ${this.name} key... (was index ${this.currentIndex})`,
    );
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    return true;
  }

  /**
   * Execute an operation with automatic key rotation on API errors,
   * exponential backoff, and configurable timeout.
   */
  public async executeWithRotation<T>(
    operation: (key: string) => Promise<T>,
    maxRetries: number = 3,
    timeoutMs: number = 15_000,
  ): Promise<T> {
    let attempts = 0;
    let lastError: unknown;

    while (attempts < maxRetries) {
      const key = this.getKey();
      if (!key) {
        throw new Error(`No API keys configured for ${this.name}`);
      }

      try {
        return await withTimeout(operation(key), timeoutMs);
      } catch (error: any) {
        lastError = error;
        const status = error?.status || error?.response?.status;
        const isQuotaError = status === 429 || status === 401 || status === 403;
        const isServerError = status === 500 || status === 502 || status === 503;
        const isTimeout = error?.name === "TimeoutError";
        const isRetryable = isQuotaError || isServerError || isTimeout;

        if (isRetryable) {
          if (isQuotaError && this.keys.length > 1) {
            this.rotate();
          }
          attempts++;
          if (attempts < maxRetries) {
            const backoffMs = Math.pow(2, attempts - 1) * 1000; // 1s, 2s, 4s
            console.warn(
              `[KeyRotator] ${this.name} attempt ${attempts}/${maxRetries} failed ` +
              `(${isTimeout ? "timeout" : `HTTP ${status}`}). ` +
              `Retrying in ${backoffMs}ms...`,
            );
            await sleep(backoffMs);
          }
        } else {
          // Non-retryable error — bubble up immediately
          throw error;
        }
      }
    }

    throw new Error(
      `[KeyRotator] Exhausted all ${maxRetries} retries for ${this.name}. Last error: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}

// Global singletons for the rotators.
export const llmKeys = new KeyRotator("GROQ_API_KEYS");
