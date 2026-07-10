import { redis, redisSub } from "../redis/client";

export interface QueuedCaller {
  id: string;
  phoneNumber?: string;
  joinedAt: number;
  priority: number; // Lower number = higher priority. Default 5.
  clientId?: string;
}

export class CallQueueManager {
  private readonly AVERAGE_CALL_DURATION_MS = 3 * 60 * 1000;
  private maxConcurrentCallsFallback: number;
  private onSlotAvailable: (() => void) | null = null;

  constructor(maxConcurrent: number = 10) {
    this.maxConcurrentCallsFallback = maxConcurrent;

    // Listen to slot availability messages from other instances
    redisSub.subscribe("voxera:slot_available").catch((err: any) => {
      console.error("[QueueManager] Failed to subscribe to slot channel:", err);
    });

    redisSub.on("message", (channel: string) => {
      if (channel === "voxera:slot_available") {
        if (this.onSlotAvailable) {
          this.onSlotAvailable();
        }
      }
    });
  }

  public async setMaxConcurrent(max: number): Promise<void> {
    await redis.set("voxera:max_concurrent_calls", max.toString());
  }

  private async getMaxConcurrentCalls(): Promise<number> {
    const val = await redis.get("voxera:max_concurrent_calls");
    return val ? parseInt(val, 10) : this.maxConcurrentCallsFallback;
  }

  public async enqueueCaller(
    callerId: string,
    phoneNumber?: string,
    priority: number = 5,
    clientId?: string
  ): Promise<QueuedCaller> {
    const length = await this.getQueueLength();
    const max = await this.getMaxConcurrentCalls();

    if (length >= max * 5) {
      await redis.incr("voxera:total_rejected");
      throw new Error(`Queue full: ${length} callers waiting`);
    }

    const joinedAt = Date.now();
    const caller: QueuedCaller = {
      id: callerId,
      phoneNumber,
      joinedAt,
      priority,
      clientId,
    };

    // Calculate composite score for priority and timestamp:
    // priority is primary ascending, joinedAt is secondary ascending
    const score = priority * 1e13 + joinedAt;

    await redis.zadd("voxera:queue", score, callerId);
    await redis.hset("voxera:caller_metadata", callerId, JSON.stringify(caller));

    return caller;
  }

  public async dequeueCaller(callerId: string): Promise<boolean> {
    const removed = await redis.zrem("voxera:queue", callerId);
    await redis.hdel("voxera:caller_metadata", callerId);
    return removed > 0;
  }

  public async peekNextCaller(): Promise<QueuedCaller | null> {
    const members = await redis.zrange("voxera:queue", 0, 0);
    if (members.length === 0) return null;

    const data = await redis.hget("voxera:caller_metadata", members[0]);
    return data ? JSON.parse(data) : null;
  }

  public async getQueuePosition(callerId: string): Promise<number> {
    const rank = await redis.zrank("voxera:queue", callerId);
    return rank !== null ? rank + 1 : -1;
  }

  public async getEstimatedWaitTimeMs(callerId: string): Promise<number> {
    const position = await this.getQueuePosition(callerId);
    if (position === -1) return 0;

    const active = await this.getActiveCallCount();
    const max = await this.getMaxConcurrentCalls();

    if (active < max && position === 1) {
      return 0; // Next in line and there is a free slot
    }

    const capacity = Math.max(1, max);
    const groupsAhead = Math.ceil(position / capacity);
    
    return groupsAhead * this.AVERAGE_CALL_DURATION_MS;
  }

  public async markCallStarted(): Promise<void> {
    await redis.incr("voxera:active_calls");
    await redis.incr("voxera:total_handled");
  }

  public async markCallEnded(): Promise<void> {
    const active = await this.getActiveCallCount();
    if (active > 0) {
      await redis.decr("voxera:active_calls");
    }
    // Publish slot availability event to Pub/Sub to trigger all instances
    await redis.publish("voxera:slot_available", "1");
  }

  /**
   * Register a callback to be invoked when a call slot becomes available.
   */
  public onSlotOpen(callback: () => void): void {
    this.onSlotAvailable = callback;
  }

  public async canAcceptCall(): Promise<boolean> {
    const active = await this.getActiveCallCount();
    const max = await this.getMaxConcurrentCalls();
    return active < max;
  }

  public async getActiveCallCount(): Promise<number> {
    const val = await redis.get("voxera:active_calls");
    return val ? parseInt(val, 10) : 0;
  }

  public async getQueueLength(): Promise<number> {
    return await redis.zcard("voxera:queue");
  }

  /**
   * Returns a snapshot of live telephony metrics for the analytics dashboard.
   */
  public async getMetrics(): Promise<{
    activeCallCount: number;
    queueLength: number;
    totalHandled: number;
    totalRejected: number;
  }> {
    const activeCallCount = await this.getActiveCallCount();
    const queueLength = await this.getQueueLength();
    const totalHandled = parseInt((await redis.get("voxera:total_handled")) || "0", 10);
    const totalRejected = parseInt((await redis.get("voxera:total_rejected")) || "0", 10);

    return {
      activeCallCount,
      queueLength,
      totalHandled,
      totalRejected,
    };
  }

  /**
   * Clear all Redis states (primarily for tests)
   */
  public async reset(): Promise<void> {
    await redis.set("voxera:active_calls", "0");
    await redis.set("voxera:total_handled", "0");
    await redis.set("voxera:total_rejected", "0");
    await redis.set("voxera:max_concurrent_calls", this.maxConcurrentCallsFallback.toString());

    const members = await redis.zrange("voxera:queue", 0, -1);
    for (const m of members) {
      await redis.zrem("voxera:queue", m);
      await redis.hdel("voxera:caller_metadata", m);
    }
  }
}

// Global singleton for use across the application
export const callQueue = new CallQueueManager();
