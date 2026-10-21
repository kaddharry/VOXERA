import { EventEmitter } from "events";

/**
 * In-process cache/queue/pub-sub store, standing in for what used to be a
 * real Redis instance (ioredis). The product decided not to run Redis at
 * all — a single app instance's own memory is enough for session STM,
 * rate-limit counters, and the call queue, and it removes an entire class
 * of "Redis unreachable" failures (MaxRetriesPerRequestError, ECONNREFUSED
 * loops) that showed up as "Failed to load analytics" with nothing
 * actually wrong with the analytics query itself.
 *
 * Known tradeoff, not an oversight: this only shares state within ONE
 * Node process's memory. `npm run dev:full` / the production custom-server
 * entrypoint both run the Next.js request handlers and the Twilio
 * WebSocket stream handler in that same single process, so pub/sub between
 * a real call's live transcript/emotion events and the dashboard's SSE
 * subscriber still works there. It stops working the moment any part of
 * this runs as genuinely separate processes — multiple app instances
 * behind a load balancer, or Vercel-style serverless functions where each
 * invocation gets its own isolated process. If VOXERA moves to that kind
 * of deployment, this file is where a real shared store (Redis or
 * otherwise) needs to come back — not every call site that uses `redis`/
 * `redisSub`.
 */
class LocalStore extends EventEmitter {
  private static store: Record<string, string> = {};
  private static hashes: Record<string, Record<string, string>> = {};
  private static zsets: Record<string, Array<{ member: string; score: number }>> = {};
  private static globalEmitter = (() => {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    return emitter;
  })();

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  async get(key: string): Promise<string | null> {
    return LocalStore.store[key] || null;
  }

  // The 3rd/4th args (e.g. "EX", seconds) mirror ioredis's SET ... EX
  // signature so call sites didn't need to branch on real-vs-local — this
  // store just doesn't expire keys, same as before.
  async set(key: string, value: string, ..._opts: unknown[]): Promise<string> {
    LocalStore.store[key] = value;
    return "OK";
  }

  async incr(key: string): Promise<number> {
    const val = parseInt(LocalStore.store[key] || "0", 10) + 1;
    LocalStore.store[key] = val.toString();
    return val;
  }

  async decr(key: string): Promise<number> {
    const val = parseInt(LocalStore.store[key] || "0", 10) - 1;
    LocalStore.store[key] = val.toString();
    return val;
  }

  // Hash operations
  async hset(key: string, field: string, value: string): Promise<number> {
    if (!LocalStore.hashes[key]) LocalStore.hashes[key] = {};
    LocalStore.hashes[key][field] = value;
    return 1;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return LocalStore.hashes[key]?.[field] || null;
  }

  async hdel(key: string, field: string): Promise<number> {
    if (LocalStore.hashes[key]?.[field]) {
      delete LocalStore.hashes[key][field];
      return 1;
    }
    return 0;
  }

  // Sorted Set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!LocalStore.zsets[key]) LocalStore.zsets[key] = [];
    LocalStore.zsets[key] = LocalStore.zsets[key].filter((i) => i.member !== member);
    LocalStore.zsets[key].push({ member, score });
    LocalStore.zsets[key].sort((a, b) => a.score - b.score);
    return 1;
  }

  async zrem(key: string, member: string): Promise<number> {
    if (!LocalStore.zsets[key]) return 0;
    const initialLen = LocalStore.zsets[key].length;
    LocalStore.zsets[key] = LocalStore.zsets[key].filter((i) => i.member !== member);
    return initialLen > LocalStore.zsets[key].length ? 1 : 0;
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const zset = LocalStore.zsets[key] || [];
    const length = zset.length;
    const startIdx = start < 0 ? length + start : start;
    const stopIdx = stop < 0 ? length + stop : stop;
    return zset.slice(startIdx, stopIdx + 1).map((i) => i.member);
  }

  async zrank(key: string, member: string): Promise<number | null> {
    const zset = LocalStore.zsets[key] || [];
    const idx = zset.findIndex((i) => i.member === member);
    return idx >= 0 ? idx : null;
  }

  async zcard(key: string): Promise<number> {
    return LocalStore.zsets[key]?.length || 0;
  }

  // Pub/Sub simulation — in-process only (see class doc above).
  async publish(channel: string, message: string): Promise<number> {
    LocalStore.globalEmitter.emit("message", channel, message);
    return 1;
  }

  async subscribe(channel: string): Promise<void> {
    LocalStore.globalEmitter.on("message", (ch, msg) => {
      if (ch === channel) {
        this.emit("message", ch, msg);
      }
    });
  }

  public static reset() {
    LocalStore.store = {};
    LocalStore.hashes = {};
    LocalStore.zsets = {};
    LocalStore.globalEmitter.removeAllListeners();
  }
}

// ─── Export Clients ──────────────────────────────────────────────────────────
// Two instances (not one) so the pub/sub "subscriber" role stays separate
// from the "publisher/command" role, same shape callers already expect —
// they both read/write the same static in-process store under the hood.

const redis = new LocalStore();
const redisSub = new LocalStore();

export { redis, redisSub, LocalStore };
