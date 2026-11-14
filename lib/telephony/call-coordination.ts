import { supabase } from "../db/supabase";

/**
 * Call capacity and the caller queue, kept in Supabase Postgres
 * (sql/migration_v33.sql) so every Vercel Function instance sees the same
 * state. Replaces the Redis-backed lib/queue/manager.ts:
 *
 *  - Each live call holds one LEASE keyed by its Twilio CallSid instead of
 *    bumping a shared counter. The call renews it while it runs; if the
 *    Function dies mid-call (e.g. at Vercel's 300 s limit) the lease simply
 *    expires, so a crashed call can never hold a slot forever (the counter
 *    used to leak, eventually making every call "all lines busy").
 *  - Acquire/renew/release and queue claims are Postgres functions run in a
 *    single transaction under an advisory lock, never read-then-write here.
 *  - Queued callers are dispatched by Twilio's own <Enqueue> waitUrl polls
 *    (app/api/telephony/queue-wait), so nothing needs a long-running process
 *    or a pub/sub listener.
 *
 * If the database itself can't be reached, calls are let through rather than
 * refused (a patient reaching the agent matters more than an exact cap), and
 * a structured `call_capacity_unavailable` warning is logged.
 */

/** How long a slot is held without renewal. A live call renews every RENEW_EVERY_MS. */
export const CALL_SLOT_LEASE_SECONDS = 120;
export const CALL_SLOT_RENEW_EVERY_MS = 45_000;

export interface SlotResult {
  acquired: boolean;
  alreadyHeld: boolean;
  active: number | null;
  max: number | null;
  /** True when the database couldn't be reached and the call was let through. */
  degraded?: boolean;
}

export interface QueueResult {
  queued: boolean;
  position: number | null;
  reason?: string;
  degraded?: boolean;
}

export interface DispatchResult {
  dispatch: boolean;
  reason: string;
  position?: number | null;
}

export interface TelephonyMetrics {
  activeCallCount: number;
  maxConcurrentCalls: number;
  queueLength: number;
  handledToday: number;
  rejectedToday: number;
}

function logUnavailable(operation: string, callSid: string | null, err: unknown) {
  console.warn(
    JSON.stringify({
      service: "telephony",
      event: "call_capacity_unavailable",
      operation,
      callSid,
      error: err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err),
    }),
  );
}

export async function acquireCallSlot(callSid: string, clientId: string | null): Promise<SlotResult> {
  try {
    const { data, error } = await supabase.rpc("acquire_call_slot", {
      p_call_sid: callSid,
      p_client_id: clientId,
      p_lease_seconds: CALL_SLOT_LEASE_SECONDS,
    });
    if (error) throw error;
    return {
      acquired: Boolean(data?.acquired),
      alreadyHeld: Boolean(data?.already_held),
      active: typeof data?.active === "number" ? data.active : null,
      max: typeof data?.max === "number" ? data.max : null,
    };
  } catch (err) {
    logUnavailable("acquire_call_slot", callSid, err);
    return { acquired: true, alreadyHeld: false, active: null, max: null, degraded: true };
  }
}

export async function renewCallSlot(callSid: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("renew_call_slot", { p_call_sid: callSid, p_lease_seconds: CALL_SLOT_LEASE_SECONDS });
    if (error) throw error;
    return Boolean(data);
  } catch (err) {
    logUnavailable("renew_call_slot", callSid, err);
    return false;
  }
}

/** Frees this call's slot. Idempotent: the WebSocket close and Twilio's status callback both call it. */
export async function releaseCallSlot(callSid: string, reason: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("release_call_slot", { p_call_sid: callSid, p_reason: reason });
    if (error) throw error;
    return Boolean(data);
  } catch (err) {
    logUnavailable("release_call_slot", callSid, err);
    return false;
  }
}

export async function enqueueCall(callSid: string, clientId: string | null, callerNumber: string, priority: number): Promise<QueueResult> {
  try {
    const { data, error } = await supabase.rpc("enqueue_call", {
      p_call_sid: callSid,
      p_client_id: clientId,
      p_caller_number: callerNumber,
      p_priority: priority,
    });
    if (error) throw error;
    return { queued: Boolean(data?.queued), position: data?.position ?? null, reason: data?.reason };
  } catch (err) {
    logUnavailable("enqueue_call", callSid, err);
    return { queued: false, position: null, reason: "unavailable", degraded: true };
  }
}

/** One waitUrl poll for a queued caller: true when they should leave the queue and connect now. */
export async function tryDispatchQueuedCall(callSid: string): Promise<DispatchResult> {
  try {
    const { data, error } = await supabase.rpc("try_dispatch_queued_call", {
      p_call_sid: callSid,
      p_lease_seconds: CALL_SLOT_LEASE_SECONDS,
      p_stale_seconds: 90,
    });
    if (error) throw error;
    return { dispatch: Boolean(data?.dispatch), reason: String(data?.reason ?? "unknown"), position: data?.position ?? null };
  } catch (err) {
    logUnavailable("try_dispatch_queued_call", callSid, err);
    return { dispatch: false, reason: "unavailable" };
  }
}

export async function finishQueuedCall(callSid: string, status: "dispatched" | "abandoned" | "failed", error?: string): Promise<boolean> {
  try {
    const { data, error: rpcError } = await supabase.rpc("finish_queued_call", { p_call_sid: callSid, p_status: status, p_error: error ?? null });
    if (rpcError) throw rpcError;
    return Boolean(data);
  } catch (err) {
    logUnavailable("finish_queued_call", callSid, err);
    return false;
  }
}

export async function getTelephonyMetrics(): Promise<TelephonyMetrics | null> {
  try {
    const { data, error } = await supabase.rpc("telephony_metrics");
    if (error) throw error;
    return {
      activeCallCount: Number(data?.active_calls ?? 0),
      maxConcurrentCalls: Number(data?.max_concurrent_calls ?? 0),
      queueLength: Number(data?.queue_length ?? 0),
      handledToday: Number(data?.handled_today ?? 0),
      rejectedToday: Number(data?.rejected_today ?? 0),
    };
  } catch (err) {
    logUnavailable("telephony_metrics", null, err);
    return null;
  }
}

/** Frees expired leases and cleans up the queue; run by the scheduled cron. */
export async function recoverTelephonyState(): Promise<Record<string, number> | null> {
  try {
    const { data, error } = await supabase.rpc("recover_telephony_state", { p_stale_seconds: 90 });
    if (error) throw error;
    return data as Record<string, number>;
  } catch (err) {
    logUnavailable("recover_telephony_state", null, err);
    return null;
  }
}
