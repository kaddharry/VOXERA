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
 *
 * "One process" is not the same as "one copy of this module", though. The
 * custom server (custom-server.ts, run by tsx) imports this file through
 * the telephony stream handler, while Next.js compiles its own separate
 * copy into the route-handler bundles (e.g. the live SSE route). Two module
 * copies meant two sets of static fields — two emitters — so a live call's
 * events were published on one and the dashboard listened on the other,
 * and nothing streamed. The shared state therefore lives on `globalThis`
 * under a Symbol.for() key, which every copy in the process resolves to
 * the same object.
 */
interface SharedLocalState {
  store: Record<string, string>;
  hashes: Record<string, Record<string, string>>;
  zsets: Record<string, Array<{ member: string; score: number }>>;
  emitter: EventEmitter;
}

const SHARED_KEY = Symbol.for("voxera.localStore.shared");

function sharedState(): SharedLocalState {
  const g = globalThis as typeof globalThis & { [SHARED_KEY]?: SharedLocalState };
  if (!g[SHARED_KEY]) {
    const emitter = new EventEmitter();
    // One listener per subscribed LocalStore instance (not per channel), so
    // this only grows with open SSE connections; 0 = no warning cap.
    emitter.setMaxListeners(0);
    g[SHARED_KEY] = { store: {}, hashes: {}, zsets: {}, emitter };
  }
  return g[SHARED_KEY];
}

class LocalStore extends EventEmitter {
  private static get store() {
    return sharedState().store;
  }
  private static get hashes() {
    return sharedState().hashes;
  }
  private static get zsets() {
    return sharedState().zsets;
  }
  private static get globalEmitter() {
    return sharedState().emitter;
  }

  /** Channels this instance is subscribed to. */
  private channels = new Set<string>();
  /** This instance's single forwarder on the shared emitter, attached only
   * while it has at least one channel. */
  private forwarder = (channel: string, message: string) => {
    if (this.channels.has(channel)) this.emit("message", channel, message);
  };

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

  // Subscribing to the same channel twice is a no-op, like real Redis.
  // Previously every subscribe() call added another permanent forwarder, so
  // a channel subscribed twice (e.g. the dashboard reconnecting its SSE
  // stream) delivered every message twice — and none were ever removed.
  async subscribe(channel: string): Promise<void> {
    this.channels.add(channel);
    const emitter = LocalStore.globalEmitter;
    if (!emitter.listeners("message").includes(this.forwarder)) {
      emitter.on("message", this.forwarder);
    }
  }

  /** Unsubscribes from one channel, or from every channel when called with
   * no argument. Detaches this instance from the shared emitter once it has
   * no channels left, so a closed SSE connection leaves nothing behind. */
  async unsubscribe(channel?: string): Promise<void> {
    if (channel === undefined) this.channels.clear();
    else this.channels.delete(channel);
    if (this.channels.size === 0) {
      LocalStore.globalEmitter.removeListener("message", this.forwarder);
    }
  }

  public static reset() {
    const state = sharedState();
    state.store = {};
    state.hashes = {};
    state.zsets = {};
    state.emitter.removeAllListeners();
  }
}

// ─── Export Clients ──────────────────────────────────────────────────────────
// Two instances (not one) so the pub/sub "subscriber" role stays separate
// from the "publisher/command" role, same shape callers already expect —
// they both read/write the same static in-process store under the hood.

const redis = new LocalStore();
const redisSub = new LocalStore();

export { redis, redisSub, LocalStore };
