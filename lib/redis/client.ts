import Redis from "ioredis";
import { EventEmitter } from "events";

class MockRedis extends EventEmitter {
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
    return MockRedis.store[key] || null;
  }

  async set(key: string, value: string): Promise<string> {
    MockRedis.store[key] = value;
    return "OK";
  }

  async incr(key: string): Promise<number> {
    const val = parseInt(MockRedis.store[key] || "0", 10) + 1;
    MockRedis.store[key] = val.toString();
    return val;
  }

  async decr(key: string): Promise<number> {
    const val = parseInt(MockRedis.store[key] || "0", 10) - 1;
    MockRedis.store[key] = val.toString();
    return val;
  }

  // Hash operations
  async hset(key: string, field: string, value: string): Promise<number> {
    if (!MockRedis.hashes[key]) MockRedis.hashes[key] = {};
    MockRedis.hashes[key][field] = value;
    return 1;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return MockRedis.hashes[key]?.[field] || null;
  }

  async hdel(key: string, field: string): Promise<number> {
    if (MockRedis.hashes[key]?.[field]) {
      delete MockRedis.hashes[key][field];
      return 1;
    }
    return 0;
  }

  // Sorted Set operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!MockRedis.zsets[key]) MockRedis.zsets[key] = [];
    MockRedis.zsets[key] = MockRedis.zsets[key].filter((i) => i.member !== member);
    MockRedis.zsets[key].push({ member, score });
    MockRedis.zsets[key].sort((a, b) => a.score - b.score);
    return 1;
  }

  async zrem(key: string, member: string): Promise<number> {
    if (!MockRedis.zsets[key]) return 0;
    const initialLen = MockRedis.zsets[key].length;
    MockRedis.zsets[key] = MockRedis.zsets[key].filter((i) => i.member !== member);
    return initialLen > MockRedis.zsets[key].length ? 1 : 0;
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const zset = MockRedis.zsets[key] || [];
    const length = zset.length;
    const startIdx = start < 0 ? length + start : start;
    const stopIdx = stop < 0 ? length + stop : stop;
    return zset.slice(startIdx, stopIdx + 1).map((i) => i.member);
  }

  async zrank(key: string, member: string): Promise<number | null> {
    const zset = MockRedis.zsets[key] || [];
    const idx = zset.findIndex((i) => i.member === member);
    return idx >= 0 ? idx : null;
  }

  async zcard(key: string): Promise<number> {
    return MockRedis.zsets[key]?.length || 0;
  }

  // Pub/Sub simulation
  async publish(channel: string, message: string): Promise<number> {
    MockRedis.globalEmitter.emit("message", channel, message);
    return 1;
  }

  async subscribe(channel: string): Promise<void> {
    MockRedis.globalEmitter.on("message", (ch, msg) => {
      if (ch === channel) {
        this.emit("message", ch, msg);
      }
    });
  }

  public static reset() {
    MockRedis.store = {};
    MockRedis.hashes = {};
    MockRedis.zsets = {};
    MockRedis.globalEmitter.removeAllListeners();
  }
}

// ─── Export Clients ──────────────────────────────────────────────────────────

const redisUrl = process.env.REDIS_URL;

let redis: any;
let redisSub: any;
let isMock = false;

if (redisUrl) {
  console.log("[Redis] Initializing real Redis client connections...");
  redis = new Redis(redisUrl);
  redisSub = new Redis(redisUrl);
} else {
  console.warn("[Redis] REDIS_URL not configured. Falling back to in-memory MockRedis...");
  redis = new MockRedis();
  redisSub = new MockRedis();
  isMock = true;
}

export { redis, redisSub, isMock, MockRedis };
