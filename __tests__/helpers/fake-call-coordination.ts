/** No-op stand-in for lib/telephony/call-coordination.ts in route tests (SQL is tested in __tests__/db). */
import { vi } from "vitest";

export const CALL_SLOT_LEASE_SECONDS = 120;
export const CALL_SLOT_RENEW_EVERY_MS = 45_000;
export const acquireCallSlot = vi.fn(async () => ({ acquired: true, alreadyHeld: false, active: 1, max: 10 }));
export const renewCallSlot = vi.fn(async () => true);
export const releaseCallSlot = vi.fn(async () => true);
export const enqueueCall = vi.fn(async () => ({ queued: true, position: 1 }));
export const tryDispatchQueuedCall = vi.fn(async () => ({ dispatch: false, reason: "no_capacity", position: 1 }));
export const finishQueuedCall = vi.fn(async () => true);
export const getTelephonyMetrics = vi.fn(async () => ({ activeCallCount: 0, maxConcurrentCalls: 10, queueLength: 0, handledToday: 0, rejectedToday: 0 }));
export const recoverTelephonyState = vi.fn(async () => ({}));
