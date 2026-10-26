import { describe, it, expect, beforeEach, vi } from "vitest";
import { LocalStore } from "../../lib/redis/client";

/**
 * Live Calls streaming regression tests. The live SSE route (compiled by
 * Next.js) and the call pipeline (loaded by the custom server) each get
 * their own copy of lib/redis/client.ts. Pub/sub only works if both copies
 * share one emitter.
 */
describe("LocalStore pub/sub", () => {
  beforeEach(() => {
    LocalStore.reset();
  });

  it("delivers a message published by a separate copy of the module", async () => {
    const subscriber = new LocalStore();
    const received: string[] = [];
    subscriber.on("message", (_ch: string, msg: string) => received.push(msg));
    await subscriber.subscribe("session:abc");

    // A fresh module instance, the way Next.js bundles its own copy.
    vi.resetModules();
    const otherCopy = await import("../../lib/redis/client");
    expect(otherCopy.LocalStore).not.toBe(LocalStore);
    await otherCopy.redis.publish("session:abc", "hello");

    expect(received).toEqual(["hello"]);
  });

  it("delivers each message once even when a channel is subscribed twice", async () => {
    const subscriber = new LocalStore();
    const received: string[] = [];
    subscriber.on("message", (_ch: string, msg: string) => received.push(msg));
    await subscriber.subscribe("session:abc");
    await subscriber.subscribe("session:abc");

    await new LocalStore().publish("session:abc", "once");

    expect(received).toEqual(["once"]);
  });

  it("only forwards channels the instance subscribed to", async () => {
    const subscriber = new LocalStore();
    const received: string[] = [];
    subscriber.on("message", (ch: string) => received.push(ch));
    await subscriber.subscribe("session:abc");

    const publisher = new LocalStore();
    await publisher.publish("session:other", "x");
    await publisher.publish("session:abc", "y");

    expect(received).toEqual(["session:abc"]);
  });

  it("stops delivering and detaches from the shared emitter after unsubscribe", async () => {
    const subscriber = new LocalStore();
    const received: string[] = [];
    subscriber.on("message", (_ch: string, msg: string) => received.push(msg));
    await subscriber.subscribe("session:abc");

    const publisher = new LocalStore();
    await publisher.publish("session:abc", "before");
    await subscriber.unsubscribe();
    await publisher.publish("session:abc", "after");

    expect(received).toEqual(["before"]);
  });

  it("shares stored keys across module copies", async () => {
    await new LocalStore().set("k", "v");
    vi.resetModules();
    const otherCopy = await import("../../lib/redis/client");
    expect(await otherCopy.redis.get("k")).toBe("v");
  });
});
