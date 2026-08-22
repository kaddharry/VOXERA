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

/** Fallback cooldown when a rate/quota-limit error's "try again in ..."
 * duration can't be parsed — long enough to stop hammering a genuinely
 * exhausted key every turn, short enough not to miss a quota window that
 * actually reset sooner than expected. */
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

/** Parses Groq's (and similarly-formatted providers') "Please try again in
 * 18m8.208s" / "in 4m19.2s" / "in 45.2s" suffix out of a rate-limit error
 * message. Returns null if no such duration is present. */
function parseRetryAfterMs(message: string | undefined): number | null {
  if (!message) return null;
  const match = message.match(/try again in\s+(?:(\d+)m)?([\d.]+)s/i);
  if (!match) return null;
  const minutes = match[1] ? parseInt(match[1], 10) : 0;
  const seconds = parseFloat(match[2]);
  if (Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
  return Math.round((minutes * 60 + seconds) * 1000);
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
  // Per-key-index epoch ms until which that key is known (from a recent
  // real failure, not a live probe) to be rate/quota-limited and should be
  // skipped without trying it again. This is what lets a session "remember"
  // which key already failed instead of re-probing every key on every
  // single turn — the whole point being avoiding a live check per call.
  private cooldownUntil: number[];

  constructor(envVarName: string) {
    this.name = envVarName;
    const raw = process.env[envVarName] ?? "";
    this.keys = raw
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    this.cooldownUntil = new Array(this.keys.length).fill(0);

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

  private isOnCooldown(index: number): boolean {
    return this.cooldownUntil[index] > Date.now();
  }

  private markCooldown(index: number, ms: number): void {
    this.cooldownUntil[index] = Date.now() + ms;
  }

  /**
   * Moves currentIndex forward (wrapping) to the first key NOT currently on
   * cooldown, without making any network call — purely from this
   * instance's own memory of past failures. Called once up front in
   * executeWithRotation ("check which key has quota before starting" using
   * cached knowledge, never a live per-key probe) and again after each
   * rotation so a multi-key skip past several already-known-bad keys
   * happens in one step instead of one wasted attempt per key. If every
   * key is on cooldown, leaves currentIndex as-is — a stale cooldown
   * estimate is still worth trying rather than refusing to try at all.
   */
  private skipToAvailableKey(): void {
    if (this.keys.length <= 1) return;
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      if (!this.isOnCooldown(idx)) {
        this.currentIndex = idx;
        return;
      }
    }
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
    /**
     * Base for the exponential backoff between retries (1x, 2x, 4x...).
     * Defaults to 1000ms (1s, 2s, 4s) for non-latency-sensitive callers.
     * Real-time voice turns pass a much smaller value (see llm.ts's
     * REALTIME_RETRY_BUDGET) — a live caller is on the line waiting, so a
     * multi-second backoff between retries is never acceptable there, no
     * matter how generous it is for a background/one-off generation task.
     */
    backoffBaseMs: number = 1000,
  ): Promise<T> {
    let attempts = 0;
    // A 429 whose message names an "organization" LOOKS org-wide, but
    // comma-separated keys in one env var are NOT guaranteed to be the same
    // Groq account — verified live: a real GROQ_API_KEYS with 3 keys turned
    // out to have keys 1-2 on one org and key 3 on a genuinely different
    // one with its own independent quota. Rotating to a different key here
    // costs nothing (no backoff — see below), so every configured key gets
    // one shot before giving up, tracked separately from the normal
    // timeout/transient retry budget (`attempts`/backoffBaseMs) so a
    // same-org setup still fails just as fast as before.
    let orgWideRotationsUsed = 0;
    const maxOrgWideRotations = Math.max(0, this.keys.length - 1);

    // "Before starting, check which key has quota" — using only this
    // instance's own memory of past failures (no live probe call), jump
    // straight past any key already known to be on cooldown from an
    // earlier turn instead of re-discovering that the hard way every time.
    this.skipToAvailableKey();

    // Deliberately NOT `attempts < maxRetries || orgWideRotationsUsed <
    // maxOrgWideRotations` — an earlier version of this loop used exactly
    // that OR, and it was a real, live-observed latency bug: once a
    // genuine timeout/quota error had already used up the real retry
    // budget (attempts >= maxRetries), the org-wide-rotation budget still
    // being available kept the loop going anyway, letting MORE full
    // timeoutMs-length attempts happen — turns measured at 6-14 seconds
    // instead of the intended ~5s cap. Org-wide rotations are free
    // (instant, no backoff) and are allowed to happen any number of times
    // up to maxOrgWideRotations regardless of the attempts counter; genuine
    // timeout/quota retries are NOT free and must stop hard the moment
    // `attempts` reaches maxRetries, full stop, with no way for the
    // org-wide budget to extend that. The loop below is unconditional —
    // every exit is an explicit `return` or `throw` inside it.
    for (;;) {
      const key = this.getKey();
      if (!key) {
        throw new Error(`No API keys configured for ${this.name}`);
      }

      try {
        return await withTimeout(operation(key), timeoutMs);
      } catch (error: any) {
        const status = error?.status || error?.response?.status;

        // A 429 for exceeding a tokens-per-minute OR tokens-per-day budget
        // (TPM/TPD) is scoped to the ORGANIZATION on Groq (and equivalent
        // providers), not the individual API key — but that organization is
        // the one THIS KEY belongs to, not necessarily every key configured
        // for this env var. Detected via Groq's own `type`/`code` fields
        // when available (present on both the TPM and TPD variants),
        // falling back to matching the message text for other
        // OpenAI-compatible providers that report these limits similarly
        // but without those exact fields.
        const errorBody = error?.error ?? error?.response?.data?.error;
        const isOrgWideRateOrQuotaLimit =
          status === 429 &&
          (errorBody?.type === "tokens" ||
            errorBody?.code === "rate_limit_exceeded" ||
            /tokens per (minute|day)|TPM\b|TPD\b/i.test(error?.message ?? ""));
        if (isOrgWideRateOrQuotaLimit) {
          // Remember this so future calls (later turns in the same
          // session, or entirely different sessions — this instance is
          // shared, see getKeyRotator()) skip this key outright instead of
          // re-discovering it's exhausted from scratch every time. Uses
          // the provider's own reported retry window when available
          // (Groq's "try again in Xm Ys.s") rather than a blind guess.
          const retryMs = parseRetryAfterMs(error?.message) ?? DEFAULT_COOLDOWN_MS;
          this.markCooldown(this.currentIndex, retryMs);

          if (orgWideRotationsUsed < maxOrgWideRotations) {
            console.warn(
              `[KeyRotator] Org/account-wide rate or quota limit hit for ${this.name} key index ${this.currentIndex} — cooling it down for ~${Math.round(retryMs / 1000)}s and trying the next configured key immediately (no backoff) in case it belongs to a different account.`,
            );
            this.rotate();
            this.skipToAvailableKey();
            orgWideRotationsUsed++;
            continue;
          }
          console.warn(
            `[KeyRotator] Org/account-wide rate or quota limit hit on every configured ${this.name} key — none can help, failing fast so the caller can move to a different provider.`,
          );
          throw error;
        }

        const isQuotaError = status === 429 || status === 401 || status === 403;
        const isTimeoutError =
          error?.name === "TimeoutError" ||
          error?.code === "ETIMEDOUT" ||
          error?.code === "ECONNABORTED" ||
          error?.message?.includes("timed out") ||
          error?.message?.includes("timeout") ||
          status === 408 ||
          status === 500 ||
          status === 502 ||
          status === 503 ||
          status === 504;

        // A streamed completion that comes back with neither content nor
        // tool_calls is a transient routing/backend glitch, not a hard
        // failure of the provider — live-observed on ZenMux (one bad
        // response sandwiched between several good ones from the same
        // key/model seconds apart). Previously this fell through to the
        // non-retryable branch below and killed the whole provider for the
        // turn on a single blip; treat it like a timeout instead so the
        // built-in retry/backoff gets one more attempt before giving up.
        const isEmptyStreamGlitch = /returned no content or tool_calls \(streamed\)/i.test(error?.message ?? "");

        const isRetryable = isQuotaError || isTimeoutError || isEmptyStreamGlitch;

        if (isRetryable) {
          // Counted (and capped) BEFORE deciding whether to retry again —
          // this is the real, non-free budget. Exactly `maxRetries` total
          // operation() calls get made across the whole call, full stop,
          // regardless of how much org-wide-rotation budget is still
          // unused (that budget only ever pays for separate, instant,
          // free-rejection attempts — see the isOrgWideRateOrQuotaLimit
          // branch above — never for another full-timeout attempt like
          // this one).
          attempts++;
          if (attempts >= maxRetries) {
            throw new Error(
              `[KeyRotator] Exhausted all ${maxRetries} retries for ${this.name}. Last error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
          if ((isQuotaError || isTimeoutError) && this.keys.length > 1) {
            const reason = isQuotaError ? `quota (${status})` : `timeout/transient (${status ?? error?.code ?? "unknown"})`;
            console.warn(
              `[KeyRotator] ${reason} for ${this.name}. Rotating key (attempt ${attempts}/${maxRetries}).`,
            );
            this.rotate();
          } else if (isTimeoutError && this.keys.length === 1) {
            console.warn(
              `[KeyRotator] Timeout for ${this.name} (single key). Retrying (attempt ${attempts}/${maxRetries}).`,
            );
          } else if (isEmptyStreamGlitch) {
            console.warn(
              `[KeyRotator] Empty streamed response for ${this.name} — transient, retrying same key (attempt ${attempts}/${maxRetries}).`,
            );
          }
          const backoffMs = Math.pow(2, attempts - 1) * backoffBaseMs;
          console.warn(`[KeyRotator] Backing off for ${backoffMs}ms...`);
          await sleep(backoffMs);
        } else {
          throw error;
        }
      }
    }
  }
}

// One KeyRotator instance PER env var, reused across every call for the
// lifetime of the process — not reconstructed fresh per turn. A fresh
// instance every turn (the previous design) reset currentIndex/cooldowns
// back to zero every single time, so a call that had just proven key 1 (and
// key 2, if it shares key 1's account) exhausted would go probe them again
// from scratch on the very next turn instead of remembering "key 3 is the
// one that works" and using it directly. This registry is what makes that
// memory persist for the rest of the session (and every other concurrent
// call sharing the same provider) instead of re-discovering it every time.
const registry = new Map<string, KeyRotator>();

export function getKeyRotator(envVarName: string): KeyRotator {
  let rotator = registry.get(envVarName);
  if (!rotator) {
    rotator = new KeyRotator(envVarName);
    registry.set(envVarName, rotator);
  }
  return rotator;
}

/** Test-only escape hatch — clears cached instances so each test starts
 * from a clean slate instead of leaking currentIndex/cooldown state from
 * whichever test ran first against the same env var name. */
export function __resetKeyRotatorRegistryForTests(): void {
  registry.clear();
}

export const llmKeys = getKeyRotator("GROQ_API_KEYS");
