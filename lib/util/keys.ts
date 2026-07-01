/**
 * API Key Rotation Manager
 *
 * Allows supplying multiple API keys (comma-separated) via environment variables.
 * When a key hits a rate limit (429) or runs out of credits (401/403), the rotator
 * switches to the next available key automatically.
 */
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
        `[KeyRotator] Initialized ${this.name} with ${this.keys.length} keys.`,
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

    // If we have wrapped around back to 0, it means all keys in the pool failed
    // in this rapid succession. We still return true because maybe the rate limit
    // on key 0 has reset, but the caller should be aware of a potential infinite loop
    // if not capped by a maxRetries counter.
    return true;
  }

  /**
   * Helper to execute a function with automatic key rotation on API errors.
   */
  public async executeWithRotation<T>(
    operation: (key: string) => Promise<T>,
    maxRetries: number = 3,
  ): Promise<T> {
    let attempts = 0;
    let lastError: unknown;

    while (attempts < maxRetries) {
      const key = this.getKey();
      if (!key) {
        throw new Error(`No API keys configured for ${this.name}`);
      }

      try {
        return await operation(key);
      } catch (error: any) {
        lastError = error;
        const status = error?.status || error?.response?.status;
        const isQuotaError = status === 429 || status === 401 || status === 403;
        const isTimeoutError =
          error?.code === "ETIMEDOUT" ||
          error?.code === "ECONNABORTED" ||
          error?.message?.includes("timed out") ||
          error?.message?.includes("timeout") ||
          error?.message?.includes("Request timed out") ||
          status === 408 ||
          status === 502 ||
          status === 503 ||
          status === 504;

        if ((isQuotaError || isTimeoutError) && this.keys.length > 1) {
          const reason = isQuotaError ? `quota (${status})` : `timeout/transient (${status ?? error?.code ?? "unknown"})`;
          console.warn(
            `[KeyRotator] ${reason} for ${this.name}. Rotating key (attempt ${attempts + 1}/${maxRetries}).`,
          );
          this.rotate();
          attempts++;
        } else if (isTimeoutError && this.keys.length === 1) {
          // Single key — still retry in case the timeout is transient
          console.warn(
            `[KeyRotator] Timeout for ${this.name} (single key). Retrying (attempt ${attempts + 1}/${maxRetries}).`,
          );
          attempts++;
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
