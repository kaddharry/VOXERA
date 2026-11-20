-- Migration v33: Supabase-first call coordination (replaces Redis).
--
-- Everything Redis/Upstash used to hold now lives in Postgres, so every
-- Vercel Function instance sees the same state and nothing depends on a
-- long-running process:
--
--   telephony_settings  the call capacity (one row; was a Redis key)
--   call_slots          one lease per live call (was the voxera:active_calls
--                       counter, which leaked when a Function died mid-call)
--   call_queue          callers waiting for a free slot (was a Redis sorted
--                       set + a pub/sub listener that needs a live process)
--   background_jobs     durable after-call work (summary, follow-up decision,
--                       self-learning analysis) with claims and retries
--   rate_limits         fixed-window counters for public endpoints
--   session_state       small per-call state shared across turns (persona lock)
--   stm_sessions        short-term conversation memory; used by
--                       lib/memory/stm.ts but never created by a migration
--
-- All concurrent operations are Postgres functions (one transaction each,
-- serialised with an advisory lock where capacity is involved), never
-- read-then-write in JavaScript.
--
-- Access: these tables are server-only. RLS is on with NO policies, and the
-- functions are executable only by service_role, so the anon/authenticated
-- keys (browser) can neither read the tables nor call the functions.
--
-- Safe to apply to an existing project: only new tables/functions, all
-- IF NOT EXISTS / OR REPLACE; no existing table is altered except adding a
-- missing table (stm_sessions). Rollback: see the bottom of this file.

-- ─── Settings ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.telephony_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    max_concurrent_calls INTEGER NOT NULL DEFAULT 10 CHECK (max_concurrent_calls > 0),
    max_queue_length INTEGER NOT NULL DEFAULT 50 CHECK (max_queue_length >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.telephony_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── Call slot leases ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.call_slots (
    call_sid TEXT PRIMARY KEY,              -- Twilio CallSid: one slot per call, ever
    client_id TEXT,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_expires_at TIMESTAMPTZ NOT NULL,
    released_at TIMESTAMPTZ,                -- NULL = holding a slot
    release_reason TEXT                     -- stream_closed | twilio_status:<s> | lease_expired | ...
);
CREATE INDEX IF NOT EXISTS idx_call_slots_active ON public.call_slots (lease_expires_at) WHERE released_at IS NULL;

-- ─── Caller queue ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.call_queue (
    call_sid TEXT PRIMARY KEY,
    client_id TEXT,
    caller_number TEXT,
    priority INTEGER NOT NULL DEFAULT 5,    -- lower = served first
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'dispatching', 'dispatched', 'abandoned', 'failed')),
    enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_polled_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- Twilio's queue waitUrl poll; stale = caller gone
    claim_expires_at TIMESTAMPTZ,
    dispatch_attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_queue_waiting ON public.call_queue (priority, enqueued_at) WHERE status = 'waiting';

-- ─── Background jobs ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.background_jobs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    kind TEXT NOT NULL,                     -- e.g. post_call
    idempotency_key TEXT NOT NULL UNIQUE,   -- e.g. post_call:<CallSid>
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
    run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    lease_expires_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_background_jobs_due ON public.background_jobs (run_at) WHERE status IN ('pending', 'running');

-- ─── Rate limits, session state, short-term memory ──────────────────────────

CREATE TABLE IF NOT EXISTS public.rate_limits (
    key TEXT PRIMARY KEY,
    window_start TIMESTAMPTZ NOT NULL,
    hits INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS public.session_state (
    session_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 day',
    PRIMARY KEY (session_id, key)
);
CREATE INDEX IF NOT EXISTS idx_session_state_expires ON public.session_state (expires_at);

-- Column names/types match what lib/memory/stm.ts already writes.
CREATE TABLE IF NOT EXISTS public.stm_sessions (
    session_id TEXT PRIMARY KEY,
    client_id TEXT,
    utterances JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stm_sessions_updated ON public.stm_sessions (updated_at);

-- ─── Access: server only ────────────────────────────────────────────────────

ALTER TABLE public.telephony_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stm_sessions ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only service_role (which bypasses RLS) may use them.

-- ─── Internal helper ────────────────────────────────────────────────────────

-- Frees slots whose lease ran out (a Function that died mid-call can't
-- release its own). Called inside the functions below while they hold the
-- capacity lock, and by recover_telephony_state().
CREATE OR REPLACE FUNCTION public._expire_call_slots() RETURNS INTEGER AS $$
DECLARE
    n INTEGER;
BEGIN
    UPDATE public.call_slots
       SET released_at = now(), release_reason = 'lease_expired'
     WHERE released_at IS NULL AND lease_expires_at < now();
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$ LANGUAGE plpgsql;

-- ─── Call slots ─────────────────────────────────────────────────────────────

-- Atomically takes a slot for a call. Idempotent: the same CallSid never
-- holds two slots; asking again just renews its lease.
CREATE OR REPLACE FUNCTION public.acquire_call_slot(p_call_sid TEXT, p_client_id TEXT, p_lease_seconds INTEGER DEFAULT 120)
RETURNS JSONB AS $$
DECLARE
    v_max INTEGER;
    v_active INTEGER;
    v_row public.call_slots%ROWTYPE;
BEGIN
    IF p_call_sid IS NULL OR p_call_sid = '' THEN
        RAISE EXCEPTION 'p_call_sid is required';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('voxera:call_capacity'));
    PERFORM public._expire_call_slots();

    SELECT max_concurrent_calls INTO v_max FROM public.telephony_settings WHERE id = 1;
    v_max := COALESCE(v_max, 10);

    SELECT * INTO v_row FROM public.call_slots WHERE call_sid = p_call_sid;
    IF FOUND AND v_row.released_at IS NULL THEN
        UPDATE public.call_slots
           SET lease_expires_at = now() + make_interval(secs => p_lease_seconds),
               client_id = COALESCE(p_client_id, client_id)
         WHERE call_sid = p_call_sid;
        SELECT count(*) INTO v_active FROM public.call_slots WHERE released_at IS NULL;
        RETURN jsonb_build_object('acquired', true, 'already_held', true, 'active', v_active, 'max', v_max);
    END IF;

    SELECT count(*) INTO v_active FROM public.call_slots WHERE released_at IS NULL;
    IF v_active >= v_max THEN
        RETURN jsonb_build_object('acquired', false, 'already_held', false, 'active', v_active, 'max', v_max);
    END IF;

    INSERT INTO public.call_slots (call_sid, client_id, acquired_at, lease_expires_at, released_at, release_reason)
    VALUES (p_call_sid, p_client_id, now(), now() + make_interval(secs => p_lease_seconds), NULL, NULL)
    ON CONFLICT (call_sid) DO UPDATE
       SET client_id = EXCLUDED.client_id, acquired_at = now(),
           lease_expires_at = EXCLUDED.lease_expires_at, released_at = NULL, release_reason = NULL;

    RETURN jsonb_build_object('acquired', true, 'already_held', false, 'active', v_active + 1, 'max', v_max);
END;
$$ LANGUAGE plpgsql;

-- Keeps a live call's slot. False if the call no longer holds one.
CREATE OR REPLACE FUNCTION public.renew_call_slot(p_call_sid TEXT, p_lease_seconds INTEGER DEFAULT 120)
RETURNS BOOLEAN AS $$
DECLARE
    n INTEGER;
BEGIN
    UPDATE public.call_slots
       SET lease_expires_at = now() + make_interval(secs => p_lease_seconds)
     WHERE call_sid = p_call_sid AND released_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$ LANGUAGE plpgsql;

-- Frees exactly this call's slot. Safe to call any number of times (from the
-- WebSocket close AND Twilio's status callback): only the first one counts,
-- and it can never free another call's slot.
CREATE OR REPLACE FUNCTION public.release_call_slot(p_call_sid TEXT, p_reason TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    n INTEGER;
BEGIN
    UPDATE public.call_slots
       SET released_at = now(), release_reason = COALESCE(p_reason, 'released')
     WHERE call_sid = p_call_sid AND released_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$ LANGUAGE plpgsql;

-- ─── Queue ──────────────────────────────────────────────────────────────────

-- Adds a caller to the queue (idempotent per CallSid). Refuses when the
-- queue is already full, so nobody is put on hold indefinitely.
CREATE OR REPLACE FUNCTION public.enqueue_call(p_call_sid TEXT, p_client_id TEXT, p_caller_number TEXT, p_priority INTEGER DEFAULT 5)
RETURNS JSONB AS $$
DECLARE
    v_max_queue INTEGER;
    v_waiting INTEGER;
    v_existing public.call_queue%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('voxera:call_capacity'));
    SELECT max_queue_length INTO v_max_queue FROM public.telephony_settings WHERE id = 1;
    v_max_queue := COALESCE(v_max_queue, 50);

    SELECT * INTO v_existing FROM public.call_queue WHERE call_sid = p_call_sid;
    IF FOUND AND v_existing.status IN ('waiting', 'dispatching') THEN
        RETURN jsonb_build_object('queued', true, 'already_queued', true, 'position', public.queue_position(p_call_sid));
    END IF;

    SELECT count(*) INTO v_waiting FROM public.call_queue WHERE status = 'waiting';
    IF v_waiting >= v_max_queue THEN
        RETURN jsonb_build_object('queued', false, 'already_queued', false, 'position', NULL, 'reason', 'queue_full');
    END IF;

    INSERT INTO public.call_queue (call_sid, client_id, caller_number, priority, status, enqueued_at, last_polled_at, updated_at)
    VALUES (p_call_sid, p_client_id, p_caller_number, p_priority, 'waiting', now(), now(), now())
    ON CONFLICT (call_sid) DO UPDATE
       SET status = 'waiting', priority = EXCLUDED.priority, enqueued_at = now(), last_polled_at = now(),
           claim_expires_at = NULL, last_error = NULL, updated_at = now();

    RETURN jsonb_build_object('queued', true, 'already_queued', false, 'position', public.queue_position(p_call_sid));
END;
$$ LANGUAGE plpgsql;

-- 1-based place in line among waiting callers; NULL if not waiting.
CREATE OR REPLACE FUNCTION public.queue_position(p_call_sid TEXT)
RETURNS INTEGER AS $$
    SELECT CASE WHEN me.status = 'waiting' THEN (
        SELECT count(*)::int FROM public.call_queue q
         WHERE q.status = 'waiting'
           AND (q.priority < me.priority OR (q.priority = me.priority AND (q.enqueued_at, q.call_sid) <= (me.enqueued_at, me.call_sid)))
    ) END
    FROM public.call_queue me WHERE me.call_sid = p_call_sid;
$$ LANGUAGE sql STABLE;

-- Called on each of Twilio's queue waitUrl polls for this caller. Marks
-- callers who stopped polling as abandoned, and if a slot is free and this
-- caller is first in line, atomically takes the slot for them and marks
-- them 'dispatching'. Returns {dispatch: true} when they should leave the
-- queue now.
CREATE OR REPLACE FUNCTION public.try_dispatch_queued_call(p_call_sid TEXT, p_lease_seconds INTEGER DEFAULT 120, p_stale_seconds INTEGER DEFAULT 90)
RETURNS JSONB AS $$
DECLARE
    v_me public.call_queue%ROWTYPE;
    v_head TEXT;
    v_max INTEGER;
    v_active INTEGER;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('voxera:call_capacity'));
    PERFORM public._expire_call_slots();

    UPDATE public.call_queue SET last_polled_at = now(), updated_at = now()
     WHERE call_sid = p_call_sid AND status = 'waiting';

    -- Callers whose waitUrl stopped polling have hung up: don't let them block the line.
    UPDATE public.call_queue SET status = 'abandoned', updated_at = now()
     WHERE status = 'waiting' AND last_polled_at < now() - make_interval(secs => p_stale_seconds);
    -- A claimed caller whose dispatch never completed goes back in line.
    UPDATE public.call_queue SET status = 'waiting', claim_expires_at = NULL, updated_at = now()
     WHERE status = 'dispatching' AND claim_expires_at < now();

    SELECT * INTO v_me FROM public.call_queue WHERE call_sid = p_call_sid;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('dispatch', false, 'reason', 'not_queued');
    END IF;
    IF v_me.status = 'dispatching' THEN
        RETURN jsonb_build_object('dispatch', true, 'reason', 'already_claimed');
    END IF;
    IF v_me.status <> 'waiting' THEN
        RETURN jsonb_build_object('dispatch', false, 'reason', v_me.status);
    END IF;

    SELECT call_sid INTO v_head FROM public.call_queue
     WHERE status = 'waiting' ORDER BY priority, enqueued_at, call_sid LIMIT 1;
    IF v_head IS DISTINCT FROM p_call_sid THEN
        RETURN jsonb_build_object('dispatch', false, 'reason', 'not_first', 'position', public.queue_position(p_call_sid));
    END IF;

    SELECT max_concurrent_calls INTO v_max FROM public.telephony_settings WHERE id = 1;
    v_max := COALESCE(v_max, 10);
    SELECT count(*) INTO v_active FROM public.call_slots WHERE released_at IS NULL;
    IF v_active >= v_max THEN
        RETURN jsonb_build_object('dispatch', false, 'reason', 'no_capacity', 'position', 1);
    END IF;

    INSERT INTO public.call_slots (call_sid, client_id, acquired_at, lease_expires_at)
    VALUES (p_call_sid, v_me.client_id, now(), now() + make_interval(secs => p_lease_seconds))
    ON CONFLICT (call_sid) DO UPDATE
       SET acquired_at = now(), lease_expires_at = EXCLUDED.lease_expires_at, released_at = NULL, release_reason = NULL;

    UPDATE public.call_queue
       SET status = 'dispatching', claim_expires_at = now() + make_interval(secs => p_lease_seconds),
           dispatch_attempts = dispatch_attempts + 1, updated_at = now()
     WHERE call_sid = p_call_sid;

    RETURN jsonb_build_object('dispatch', true, 'reason', 'claimed');
END;
$$ LANGUAGE plpgsql;

-- Final state for a queued caller: dispatched (connected), abandoned (hung
-- up) or failed. Idempotent.
CREATE OR REPLACE FUNCTION public.finish_queued_call(p_call_sid TEXT, p_status TEXT, p_error TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    n INTEGER;
BEGIN
    IF p_status NOT IN ('dispatched', 'abandoned', 'failed') THEN
        RAISE EXCEPTION 'invalid queue status %', p_status;
    END IF;
    UPDATE public.call_queue
       SET status = p_status, last_error = p_error, claim_expires_at = NULL, updated_at = now()
     WHERE call_sid = p_call_sid AND status IN ('waiting', 'dispatching');
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$ LANGUAGE plpgsql;

-- ─── Metrics and recovery ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.telephony_metrics()
RETURNS JSONB AS $$
    SELECT jsonb_build_object(
        'active_calls', (SELECT count(*) FROM public.call_slots WHERE released_at IS NULL AND lease_expires_at >= now()),
        'max_concurrent_calls', (SELECT max_concurrent_calls FROM public.telephony_settings WHERE id = 1),
        'queue_length', (SELECT count(*) FROM public.call_queue WHERE status = 'waiting'),
        'handled_today', (SELECT count(*) FROM public.call_slots WHERE acquired_at >= date_trunc('day', now())),
        'rejected_today', (SELECT count(*) FROM public.call_queue WHERE status IN ('failed') AND updated_at >= date_trunc('day', now()))
    );
$$ LANGUAGE sql STABLE;

-- Run by the scheduled cron: frees expired slots, abandons callers who
-- stopped polling, re-queues stuck dispatches, releases stuck job leases
-- and drops old rate-limit/session rows.
CREATE OR REPLACE FUNCTION public.recover_telephony_state(p_stale_seconds INTEGER DEFAULT 90)
RETURNS JSONB AS $$
DECLARE
    v_slots INTEGER;
    v_abandoned INTEGER;
    v_requeued INTEGER;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('voxera:call_capacity'));
    v_slots := public._expire_call_slots();
    UPDATE public.call_queue SET status = 'abandoned', updated_at = now()
     WHERE status = 'waiting' AND last_polled_at < now() - make_interval(secs => p_stale_seconds);
    GET DIAGNOSTICS v_abandoned = ROW_COUNT;
    UPDATE public.call_queue SET status = 'waiting', claim_expires_at = NULL, updated_at = now()
     WHERE status = 'dispatching' AND claim_expires_at < now();
    GET DIAGNOSTICS v_requeued = ROW_COUNT;
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day';
    DELETE FROM public.session_state WHERE expires_at < now();
    RETURN jsonb_build_object('expired_slots', v_slots, 'abandoned_callers', v_abandoned, 'requeued_dispatches', v_requeued);
END;
$$ LANGUAGE plpgsql;

-- ─── Background jobs ────────────────────────────────────────────────────────

-- Creates a job once per idempotency key; returns the job (new or existing).
CREATE OR REPLACE FUNCTION public.enqueue_job(p_kind TEXT, p_idempotency_key TEXT, p_payload JSONB DEFAULT '{}'::jsonb, p_run_at TIMESTAMPTZ DEFAULT now(), p_max_attempts INTEGER DEFAULT 5)
RETURNS public.background_jobs AS $$
DECLARE
    v_job public.background_jobs%ROWTYPE;
BEGIN
    INSERT INTO public.background_jobs (kind, idempotency_key, payload, run_at, max_attempts)
    VALUES (p_kind, p_idempotency_key, COALESCE(p_payload, '{}'::jsonb), COALESCE(p_run_at, now()), COALESCE(p_max_attempts, 5))
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_job FROM public.background_jobs WHERE idempotency_key = p_idempotency_key;
    RETURN v_job;
END;
$$ LANGUAGE plpgsql;

-- Claims due jobs (pending and due, or running with an expired lease) for
-- this worker; two workers never get the same job.
CREATE OR REPLACE FUNCTION public.claim_jobs(p_kinds TEXT[], p_limit INTEGER DEFAULT 10, p_lease_seconds INTEGER DEFAULT 240)
RETURNS SETOF public.background_jobs AS $$
BEGIN
    RETURN QUERY
    UPDATE public.background_jobs j
       SET status = 'running', attempts = j.attempts + 1,
           lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
     WHERE j.id IN (
        SELECT id FROM public.background_jobs
         WHERE kind = ANY(p_kinds)
           AND attempts < max_attempts
           AND ((status = 'pending' AND run_at <= now()) OR (status = 'running' AND lease_expires_at < now()))
         ORDER BY run_at
         LIMIT p_limit
         FOR UPDATE SKIP LOCKED
     )
    RETURNING j.*;
END;
$$ LANGUAGE plpgsql;

-- Claims one specific job right away (used right after enqueuing it).
CREATE OR REPLACE FUNCTION public.claim_job_by_key(p_idempotency_key TEXT, p_lease_seconds INTEGER DEFAULT 240)
RETURNS SETOF public.background_jobs AS $$
BEGIN
    RETURN QUERY
    UPDATE public.background_jobs j
       SET status = 'running', attempts = j.attempts + 1,
           lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
     WHERE j.id IN (
        SELECT id FROM public.background_jobs
         WHERE idempotency_key = p_idempotency_key
           AND attempts < max_attempts
           AND (status = 'pending' OR (status = 'running' AND lease_expires_at < now()))
         FOR UPDATE SKIP LOCKED
     )
    RETURNING j.*;
END;
$$ LANGUAGE plpgsql;

-- Marks a claimed job done, or schedules a retry (or gives up after
-- max_attempts).
CREATE OR REPLACE FUNCTION public.complete_job(p_id TEXT, p_ok BOOLEAN, p_error TEXT DEFAULT NULL, p_retry_seconds INTEGER DEFAULT 60)
RETURNS public.background_jobs AS $$
DECLARE
    v_job public.background_jobs%ROWTYPE;
BEGIN
    IF p_ok THEN
        UPDATE public.background_jobs
           SET status = 'succeeded', completed_at = now(), lease_expires_at = NULL, last_error = NULL, updated_at = now()
         WHERE id = p_id
        RETURNING * INTO v_job;
    ELSE
        UPDATE public.background_jobs
           SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
               run_at = now() + make_interval(secs => p_retry_seconds * attempts),
               lease_expires_at = NULL, last_error = left(p_error, 2000), updated_at = now(),
               completed_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END
         WHERE id = p_id
        RETURNING * INTO v_job;
    END IF;
    RETURN v_job;
END;
$$ LANGUAGE plpgsql;

-- ─── Rate limiting ──────────────────────────────────────────────────────────

-- Fixed-window limiter, atomic per key.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key TEXT, p_limit INTEGER, p_window_ms BIGINT)
RETURNS JSONB AS $$
DECLARE
    v_row public.rate_limits%ROWTYPE;
    v_window INTERVAL := make_interval(secs => p_window_ms / 1000.0);
BEGIN
    INSERT INTO public.rate_limits (key, window_start, hits) VALUES (p_key, now(), 0)
    ON CONFLICT (key) DO NOTHING;
    SELECT * INTO v_row FROM public.rate_limits WHERE key = p_key FOR UPDATE;
    IF v_row.window_start + v_window <= now() THEN
        v_row.window_start := now();
        v_row.hits := 0;
    END IF;
    IF v_row.hits >= p_limit THEN
        UPDATE public.rate_limits SET window_start = v_row.window_start, hits = v_row.hits WHERE key = p_key;
        RETURN jsonb_build_object('allowed', false,
            'retry_after_ms', GREATEST(0, floor(extract(epoch FROM (v_row.window_start + v_window - now())) * 1000))::bigint);
    END IF;
    UPDATE public.rate_limits SET window_start = v_row.window_start, hits = v_row.hits + 1 WHERE key = p_key;
    RETURN jsonb_build_object('allowed', true, 'retry_after_ms', NULL);
END;
$$ LANGUAGE plpgsql;

-- ─── Privileges: service_role only ──────────────────────────────────────────

DO $$
DECLARE
    f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public._expire_call_slots()',
        'public.acquire_call_slot(text, text, integer)',
        'public.renew_call_slot(text, integer)',
        'public.release_call_slot(text, text)',
        'public.enqueue_call(text, text, text, integer)',
        'public.queue_position(text)',
        'public.try_dispatch_queued_call(text, integer, integer)',
        'public.finish_queued_call(text, text, text)',
        'public.telephony_metrics()',
        'public.recover_telephony_state(integer)',
        'public.enqueue_job(text, text, jsonb, timestamptz, integer)',
        'public.claim_jobs(text[], integer, integer)',
        'public.claim_job_by_key(text, integer)',
        'public.complete_job(text, boolean, text, integer)',
        'public.rate_limit_hit(text, integer, bigint)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', f);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
        END IF;
    END LOOP;
END $$;

-- ─── Live Calls: private Realtime channels ──────────────────────────────────
-- Live call events (lib/realtime/live-events.ts) are sent and received only
-- by the server with the service-role key, on PRIVATE broadcast channels.
-- Supabase checks private channels against RLS on realtime.messages, and
-- service_role bypasses RLS; no policy is added here, so no anon or
-- signed-in browser client can join these channels. (The dashboard gets the
-- events through the authorised SSE route, never from Supabase directly.)

-- ─── Rollback (manual, only if needed) ──────────────────────────────────────
-- The previous code does not use any of these objects, so rolling back the
-- app is enough; to also remove them:
--   DROP FUNCTION IF EXISTS public.rate_limit_hit(text, integer, bigint), public.complete_job(text, boolean, text, integer),
--     public.claim_job_by_key(text, integer), public.claim_jobs(text[], integer, integer),
--     public.enqueue_job(text, text, jsonb, timestamptz, integer), public.recover_telephony_state(integer),
--     public.telephony_metrics(), public.finish_queued_call(text, text, text),
--     public.try_dispatch_queued_call(text, integer, integer), public.queue_position(text),
--     public.enqueue_call(text, text, text, integer), public.release_call_slot(text, text),
--     public.renew_call_slot(text, integer), public.acquire_call_slot(text, text, integer), public._expire_call_slots();
--   DROP TABLE IF EXISTS public.rate_limits, public.session_state, public.background_jobs,
--     public.call_queue, public.call_slots, public.telephony_settings;
--   (Keep public.stm_sessions: the existing code already used it.)
