import { describe, it, expect, beforeEach } from "vitest";
import { createMigratedDb } from "../helpers/pglite-db";

/**
 * sql/migration_v33.sql against a real Postgres (PGlite): call-slot leases,
 * the caller queue, background jobs, rate limits and privileges.
 * PGlite runs one connection, so "concurrent" requests here are
 * back-to-back calls; the functions serialise on an advisory lock anyway.
 */

let db: Awaited<ReturnType<typeof createMigratedDb>>;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.db.query<T>(sql, params)).rows;
const setMax = (n: number) => q(`UPDATE public.telephony_settings SET max_concurrent_calls = $1, max_queue_length = 2 WHERE id = 1`, [n]);
const acquire = (sid: string) => db.rpc("acquire_call_slot", { p_call_sid: sid, p_client_id: "c1", p_lease_seconds: 120 }).then((r) => r.data as any);
const activeSlots = async () => Number((await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.call_slots WHERE released_at IS NULL`))[0].n);

beforeEach(async () => {
  db = await createMigratedDb();
});

describe("call slot leases", () => {
  it("never lets concurrent calls exceed capacity", async () => {
    await setMax(2);
    const results = await Promise.all(["CA1", "CA2", "CA3", "CA4"].map(acquire));
    expect(results.filter((r) => r.acquired)).toHaveLength(2);
    expect(await activeSlots()).toBe(2);
  });

  it("a repeated acquire for the same call holds one slot", async () => {
    await setMax(1);
    expect((await acquire("CA1")).acquired).toBe(true);
    const again = await acquire("CA1");
    expect(again).toMatchObject({ acquired: true, already_held: true });
    expect(await activeSlots()).toBe(1);
  });

  it("a repeated release never frees another call's slot", async () => {
    await acquire("CA1");
    await acquire("CA2");
    expect((await db.rpc("release_call_slot", { p_call_sid: "CA1", p_reason: "stream_closed" })).data).toBe(true);
    expect((await db.rpc("release_call_slot", { p_call_sid: "CA1", p_reason: "twilio_status:completed" })).data).toBe(false);
    expect(await activeSlots()).toBe(1);
    expect((await q<{ release_reason: string }>(`SELECT release_reason FROM public.call_slots WHERE call_sid = 'CA1'`))[0].release_reason).toBe("stream_closed");
  });

  it("a crashed call's expired lease is recovered, freeing capacity", async () => {
    await setMax(1);
    await acquire("CA1");
    expect((await acquire("CA2")).acquired).toBe(false);
    await q(`UPDATE public.call_slots SET lease_expires_at = now() - interval '1 second' WHERE call_sid = 'CA1'`);
    expect((await acquire("CA2")).acquired).toBe(true);
    expect((await q<{ release_reason: string }>(`SELECT release_reason FROM public.call_slots WHERE call_sid = 'CA1'`))[0].release_reason).toBe("lease_expired");
  });

  it("renewal keeps a live call's lease and fails once it's released", async () => {
    await acquire("CA1");
    expect((await db.rpc("renew_call_slot", { p_call_sid: "CA1", p_lease_seconds: 120 })).data).toBe(true);
    await db.rpc("release_call_slot", { p_call_sid: "CA1", p_reason: "x" });
    expect((await db.rpc("renew_call_slot", { p_call_sid: "CA1", p_lease_seconds: 120 })).data).toBe(false);
  });

  it("recover_telephony_state frees expired leases and the metrics agree", async () => {
    await acquire("CA1");
    await acquire("CA2");
    await q(`UPDATE public.call_slots SET lease_expires_at = now() - interval '1 second' WHERE call_sid = 'CA1'`);
    expect((await db.rpc("recover_telephony_state", { p_stale_seconds: 90 })).data).toMatchObject({ expired_slots: 1 });
    expect((await db.rpc("telephony_metrics")).data).toMatchObject({ active_calls: 1, max_concurrent_calls: 10, queue_length: 0 });
  });
});

describe("caller queue", () => {
  const enqueue = (sid: string, priority = 5) => db.rpc("enqueue_call", { p_call_sid: sid, p_client_id: "c1", p_caller_number: "+1", p_priority: priority }).then((r) => r.data as any);
  const poll = (sid: string) => db.rpc("try_dispatch_queued_call", { p_call_sid: sid, p_lease_seconds: 120, p_stale_seconds: 90 }).then((r) => r.data as any);

  it("refuses once the queue is full instead of holding callers forever", async () => {
    await setMax(1); // max_queue_length = 2
    expect((await enqueue("Q1")).queued).toBe(true);
    expect((await enqueue("Q2")).queued).toBe(true);
    expect(await enqueue("Q3")).toMatchObject({ queued: false, reason: "queue_full" });
    expect((await enqueue("Q1")).already_queued).toBe(true);
  });

  it("serves the first caller in line only when a slot is free, claiming the slot atomically", async () => {
    await setMax(1);
    await acquire("CA1");
    await enqueue("Q1");
    await enqueue("Q2");
    expect(await poll("Q1")).toMatchObject({ dispatch: false, reason: "no_capacity" });
    expect(await poll("Q2")).toMatchObject({ dispatch: false, reason: "not_first", position: 2 });
    await db.rpc("release_call_slot", { p_call_sid: "CA1", p_reason: "x" });
    expect(await poll("Q2")).toMatchObject({ dispatch: false, reason: "not_first" });
    expect(await poll("Q1")).toMatchObject({ dispatch: true, reason: "claimed" });
    expect(await poll("Q1")).toMatchObject({ dispatch: true, reason: "already_claimed" });
    expect(await activeSlots()).toBe(1);
  });

  it("higher priority callers go first", async () => {
    await enqueue("Q1", 5);
    await enqueue("VIP", 1);
    expect((await db.rpc("queue_position", { p_call_sid: "VIP" })).data).toBe(1);
    expect((await db.rpc("queue_position", { p_call_sid: "Q1" })).data).toBe(2);
  });

  it("callers who stopped polling are abandoned so they can't block the line", async () => {
    await enqueue("Q1");
    await enqueue("Q2");
    await q(`UPDATE public.call_queue SET last_polled_at = now() - interval '5 minutes' WHERE call_sid = 'Q1'`);
    expect(await poll("Q2")).toMatchObject({ dispatch: true });
    expect((await q<{ status: string }>(`SELECT status FROM public.call_queue WHERE call_sid = 'Q1'`))[0].status).toBe("abandoned");
  });

  it("a claimed dispatch that never completes goes back in line (retry without a duplicate slot)", async () => {
    await enqueue("Q1");
    expect((await poll("Q1")).dispatch).toBe(true);
    await q(`UPDATE public.call_queue SET claim_expires_at = now() - interval '1 second' WHERE call_sid = 'Q1'`);
    expect((await poll("Q1")).dispatch).toBe(true);
    expect(await activeSlots()).toBe(1);
    expect((await q<{ dispatch_attempts: number }>(`SELECT dispatch_attempts FROM public.call_queue WHERE call_sid = 'Q1'`))[0].dispatch_attempts).toBe(2);
    expect((await db.rpc("finish_queued_call", { p_call_sid: "Q1", p_status: "dispatched", p_error: null })).data).toBe(true);
    expect((await db.rpc("finish_queued_call", { p_call_sid: "Q1", p_status: "abandoned", p_error: null })).data).toBe(false);
  });
});

describe("background jobs", () => {
  const enqueue = (key: string) => db.rpc("enqueue_job", { p_kind: "post_call", p_idempotency_key: key, p_payload: { callSid: key }, p_run_at: new Date().toISOString(), p_max_attempts: 2 });

  it("one job per idempotency key", async () => {
    const a = (await enqueue("post_call:CA1")).data as any;
    const b = (await enqueue("post_call:CA1")).data as any;
    expect(a.id).toBe(b.id);
    expect(Number((await q<{ n: number }>(`SELECT count(*)::int AS n FROM public.background_jobs`))[0].n)).toBe(1);
  });

  it("a claimed job can't be claimed again until its lease expires", async () => {
    await enqueue("post_call:CA1");
    expect((await db.rpc("claim_job_by_key", { p_idempotency_key: "post_call:CA1", p_lease_seconds: 240 })).data).toHaveLength(1);
    expect((await db.rpc("claim_jobs", { p_kinds: ["post_call"], p_limit: 10, p_lease_seconds: 240 })).data).toHaveLength(0);
    await q(`UPDATE public.background_jobs SET lease_expires_at = now() - interval '1 second'`);
    expect((await db.rpc("claim_jobs", { p_kinds: ["post_call"], p_limit: 10, p_lease_seconds: 240 })).data).toHaveLength(1);
  });

  it("a failed job is retried later, then marked failed after max attempts", async () => {
    await enqueue("post_call:CA1");
    const [job] = (await db.rpc("claim_job_by_key", { p_idempotency_key: "post_call:CA1", p_lease_seconds: 240 })).data as any[];
    const retry = (await db.rpc("complete_job", { p_id: job.id, p_ok: false, p_error: "LLM down", p_retry_seconds: 0 })).data as any;
    expect(retry).toMatchObject({ status: "pending", last_error: "LLM down" });
    const [again] = (await db.rpc("claim_jobs", { p_kinds: ["post_call"], p_limit: 10, p_lease_seconds: 240 })).data as any[];
    expect(again.attempts).toBe(2);
    expect(((await db.rpc("complete_job", { p_id: again.id, p_ok: false, p_error: "still down", p_retry_seconds: 0 })).data as any).status).toBe("failed");
    expect((await db.rpc("claim_jobs", { p_kinds: ["post_call"], p_limit: 10, p_lease_seconds: 240 })).data).toHaveLength(0);
  });

  it("a succeeded job is never run again", async () => {
    await enqueue("post_call:CA1");
    const [job] = (await db.rpc("claim_job_by_key", { p_idempotency_key: "post_call:CA1", p_lease_seconds: 240 })).data as any[];
    await db.rpc("complete_job", { p_id: job.id, p_ok: true, p_error: null, p_retry_seconds: 60 });
    expect((await db.rpc("claim_job_by_key", { p_idempotency_key: "post_call:CA1", p_lease_seconds: 240 })).data).toHaveLength(0);
  });
});

describe("rate limits", () => {
  it("allows up to the limit in a window, then reports when to retry", async () => {
    const hit = () => db.rpc("rate_limit_hit", { p_key: "ip:1", p_limit: 2, p_window_ms: 60000 }).then((r) => r.data as any);
    expect((await hit()).allowed).toBe(true);
    expect((await hit()).allowed).toBe(true);
    const blocked = await hit();
    expect(blocked.allowed).toBe(false);
    expect(blocked.retry_after_ms).toBeGreaterThan(0);
  });
});

describe("privileges", () => {
  it("the new tables have RLS on and no policies (server-only)", async () => {
    const tables = ["telephony_settings", "call_slots", "call_queue", "background_jobs", "rate_limits", "session_state", "stm_sessions"];
    const rls = await q<{ relname: string; relrowsecurity: boolean }>(`SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1)`, [tables]);
    expect(rls.every((r) => r.relrowsecurity)).toBe(true);
    expect(rls).toHaveLength(tables.length);
    expect(await q(`SELECT * FROM pg_policies WHERE tablename = ANY($1)`, [tables])).toHaveLength(0);
  });

  it("only service_role may execute the functions; anon and authenticated may not", async () => {
    const rows = await q<{ proname: string; anon: boolean; authed: boolean; service: boolean }>(
      `SELECT p.proname,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN ('acquire_call_slot','release_call_slot','renew_call_slot','enqueue_call','try_dispatch_queued_call','finish_queued_call','telephony_metrics','recover_telephony_state','enqueue_job','claim_jobs','claim_job_by_key','complete_job','rate_limit_hit','queue_position','_expire_call_slots')`,
    );
    expect(rows).toHaveLength(15);
    expect(rows.filter((r) => r.anon || r.authed)).toEqual([]);
    expect(rows.every((r) => r.service)).toBe(true);
  });

  it("applies cleanly twice (safe to re-run)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    await expect(db.db.exec(fs.readFileSync(path.resolve(__dirname, "../../sql/migration_v33.sql"), "utf8"))).resolves.toBeDefined();
  });
});
