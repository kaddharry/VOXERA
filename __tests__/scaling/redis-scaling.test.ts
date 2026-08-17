import { describe, it, expect, beforeEach, vi } from "vitest";
import { CallQueueManager } from "../../lib/queue/manager";
import { MockRedis, redis } from "../../lib/redis/client";
import {
  isSupabaseHealthy,
  recordSupabaseFailure,
  recordSupabaseSuccess,
} from "../../lib/db/supabase";

describe("Distributed Redis Architecture & Telephony Scaling (Issue #13)", () => {
  beforeEach(async () => {
    // Reset the static MockRedis database to keep tests isolated
    MockRedis.reset();
  });

  describe("CallQueueManager Distributed Queue Synchronization", () => {
    it("synchronizes queue and metrics across multiple CallQueueManager instances", async () => {
      const q1 = new CallQueueManager(5);
      const q2 = new CallQueueManager(5);

      await q1.reset();

      // Enqueue on Instance 1
      await q1.enqueueCaller("call-A", "+15550199", 5, "client-A");

      // Enqueue on Instance 2
      await q2.enqueueCaller("call-B", "+15550200", 3, "client-A"); // Higher priority (3 < 5)

      // Verify that both instances see the exact same queue length (2)
      expect(await q1.getQueueLength()).toBe(2);
      expect(await q2.getQueueLength()).toBe(2);

      // Verify priority ordering: call-B should be peeked first because of higher priority (3)
      const next1 = await q1.peekNextCaller();
      const next2 = await q2.peekNextCaller();
      expect(next1?.id).toBe("call-B");
      expect(next2?.id).toBe("call-B");

      // Verify wait time estimations are identical
      expect(await q1.getQueuePosition("call-B")).toBe(1);
      expect(await q2.getQueuePosition("call-A")).toBe(2);
    });

    it("notifies scale-out instances of slot availability using Pub/Sub", async () => {
      const q1 = new CallQueueManager(2);
      const q2 = new CallQueueManager(2);

      await q1.reset();

      // Register slot open callback on Instance 2
      const slotOpenSpy = vi.fn();
      q2.onSlotOpen(slotOpenSpy);

      // Start call on Instance 1
      await q1.markCallStarted();
      expect(await q2.getActiveCallCount()).toBe(1);

      // End call on Instance 1 (should publish voxera:slot_available)
      await q1.markCallEnded();

      // Yield event loop to allow Pub/Sub callback to execute
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Verify Instance 2 received the message and executed its callback
      expect(slotOpenSpy).toHaveBeenCalled();
    });
  });

  describe("Distributed Supabase Circuit Breaker", () => {
    beforeEach(async () => {
      // Clear Supabase circuit keys from Redis
      await redis.set("voxera:cb:consecutive_failures", "0");
      await redis.set("voxera:cb:last_failure_at", "0");

      // Reset local memory by triggering success
      recordSupabaseSuccess();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it("propagates circuit breaker trips to all instances via Redis", async () => {
      // Verify healthy initially
      expect(isSupabaseHealthy()).toBe(true);

      // Threshold is 3 (BUG-D1) — a single transient blip must NOT open the
      // circuit, or one network hiccup blacks out memory for the rest of a call.
      recordSupabaseFailure();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(isSupabaseHealthy()).toBe(true);

      // Two more consecutive failures reach the threshold of 3.
      recordSupabaseFailure();
      recordSupabaseFailure();

      // Yield to allow Pub/Sub state sync to update other nodes
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Verify circuit is now open after the threshold is reached
      expect(isSupabaseHealthy()).toBe(false);

      // Verify Redis contains the failures (the point of this test: propagation)
      const redisFailures = await redis.get("voxera:cb:consecutive_failures");
      expect(redisFailures).toBe("3");
    });
  });
});