/**
 * Tests: Call Queue Manager (lib/queue/manager.ts)
 * Sprint 1 — FR-19 Call Queue Management
 *
 * Run: npm run test:run
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CallQueueManager } from "../../lib/queue/manager";

// Use a fresh instance per test — reset mock state
let q: CallQueueManager;

describe("CallQueueManager — enqueue / dequeue", () => {
  beforeEach(async () => {
    q = new CallQueueManager();
    await q.reset();
  });

  it("enqueues a caller and returns their record", async () => {
    const caller = await q.enqueueCaller("C-001", "+919999999999");

    expect(caller.id).toBe("C-001");
    expect(caller.phoneNumber).toBe("+919999999999");
    expect(caller.joinedAt).toBeGreaterThan(0);
  });

  it("queue length increases on enqueue, decreases on dequeue", async () => {
    await q.enqueueCaller("C-001");
    await q.enqueueCaller("C-002");
    expect(await q.getQueueLength()).toBe(2);

    await q.dequeueCaller("C-001");
    expect(await q.getQueueLength()).toBe(1);
  });

  it("dequeueCaller returns true when removed, false if not found", async () => {
    await q.enqueueCaller("C-001");

    expect(await q.dequeueCaller("C-001")).toBe(true);
    expect(await q.dequeueCaller("C-999")).toBe(false); // never existed
  });

  it("getQueuePosition returns 1-indexed position, -1 if not in queue", async () => {
    await q.enqueueCaller("C-001");
    await q.enqueueCaller("C-002");
    await q.enqueueCaller("C-003");

    expect(await q.getQueuePosition("C-001")).toBe(1);
    expect(await q.getQueuePosition("C-002")).toBe(2);
    expect(await q.getQueuePosition("C-003")).toBe(3);
    expect(await q.getQueuePosition("C-999")).toBe(-1);
  });
});

describe("CallQueueManager — active call tracking", () => {
  beforeEach(async () => {
    q = new CallQueueManager();
    await q.reset();
  });

  it("markCallStarted increments active count", async () => {
    expect(await q.getActiveCallCount()).toBe(0);
    await q.markCallStarted();
    await q.markCallStarted();
    expect(await q.getActiveCallCount()).toBe(2);
  });

  it("markCallEnded decrements active count, never below 0", async () => {
    await q.markCallStarted();
    await q.markCallEnded();
    expect(await q.getActiveCallCount()).toBe(0);

    // Should not go negative
    await q.markCallEnded();
    expect(await q.getActiveCallCount()).toBe(0);
  });

  it("getMetrics returns both activeCallCount and queueLength", async () => {
    await q.markCallStarted();
    await q.markCallStarted();
    await q.enqueueCaller("C-001");

    const m = await q.getMetrics();
    expect(m.activeCallCount).toBe(2);
    expect(m.queueLength).toBe(1);
  });
});

describe("CallQueueManager — wait time estimation", () => {
  beforeEach(async () => {
    q = new CallQueueManager();
    await q.reset();
  });

  it("returns 0 wait if slots are free and caller is first in queue", async () => {
    await q.enqueueCaller("C-001");
    expect(await q.getEstimatedWaitTimeMs("C-001")).toBe(0);
  });

  it("returns 0 if caller not in queue", async () => {
    expect(await q.getEstimatedWaitTimeMs("ghost")).toBe(0);
  });

  it("returns 3 minutes wait when all 10 slots are full and caller is first", async () => {
    for (let i = 0; i < 10; i++) await q.markCallStarted();
    await q.enqueueCaller("C-001");

    const wait = await q.getEstimatedWaitTimeMs("C-001");
    expect(wait).toBe(3 * 60 * 1000); // 180_000 ms
  });

  it("caller in 2nd group waits 2x average duration", async () => {
    for (let i = 0; i < 10; i++) await q.markCallStarted(); // fill all slots
    for (let i = 1; i <= 11; i++) await q.enqueueCaller(`C-${i.toString().padStart(3, "0")}`);

    const wait = await q.getEstimatedWaitTimeMs("C-011");
    expect(wait).toBe(2 * 3 * 60 * 1000); // 360_000 ms
  });
});
