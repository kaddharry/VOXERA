-- Migration v18: Follow-up scheduling + retry engine + human-review alerts.
--
-- Spec §10/§16.7/§16.10. First-release scope only (per spec §19 Batch 4 /
-- §25): individual patient schedules with a configurable retry policy, not
-- a full reusable-programme authoring system. "maxAttempts" INCLUDES the
-- initial attempt (spec §24 Q4 explicitly flags this ambiguity — resolved
-- here as a default since no product-owner answer was given; the UI must
-- say so, see app/admin/patients/page.tsx's follow-up form).

CREATE TABLE IF NOT EXISTS public.follow_up_tasks (
    id TEXT PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    "agentId" TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'dispatching', 'calling', 'completed', 'exhausted', 'needs_review', 'cancelled', 'paused')),
    "nextAttemptAt" BIGINT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    -- Local calling window, minutes since midnight (e.g. 600 = 10:00). Both
    -- null means "no window restriction" (call at the exact scheduled time).
    "windowStartMinute" INTEGER,
    "windowEndMinute" INTEGER,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "retryDelayMinutes" INTEGER NOT NULL DEFAULT 30,
    "finalAction" TEXT NOT NULL DEFAULT 'needs_review' CHECK ("finalAction" IN ('needs_review', 'completed', 'cancelled')),
    "lastOutcome" TEXT,
    "pausedAt" BIGINT,
    "cancelledAt" BIGINT,
    "completedAt" BIGINT,
    "createdAt" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
    -- Dispatch lease: claimed by one worker (claimedAt/claimedBy set) so
    -- another process/instance can't dispatch the same due task twice.
    -- lib/scheduler/dispatcher.ts clears these after a dispatch attempt;
    -- a stale lease (claimedAt older than the lease TTL) is reclaimable,
    -- recovering from a worker crash mid-dispatch.
    "claimedAt" BIGINT,
    "claimedBy" TEXT
);

CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_client ON public.follow_up_tasks ("clientId");
CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_patient ON public.follow_up_tasks ("patientId");
CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_due ON public.follow_up_tasks (status, "nextAttemptAt");

ALTER TABLE public.follow_up_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own follow-up tasks" ON public.follow_up_tasks;
CREATE POLICY "Tenants can manage their own follow-up tasks" ON public.follow_up_tasks
    FOR ALL USING (auth.uid()::text = "clientId");

-- Links a call attempt back to the task that scheduled it, so the status
-- webhook (app/api/telephony/status/route.ts) can decide retry vs. final
-- action when the call ends.
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS "followUpTaskId" TEXT;
CREATE INDEX IF NOT EXISTS idx_call_logs_followup_task ON public.call_logs ("followUpTaskId");

-- Human-review / attention queue (spec §16.10). Deliberately generic
-- (reason + optional links), not scoped to only follow-up exhaustion —
-- a hospital-configured escalation during a live call can also create one
-- later without a schema change.
CREATE TABLE IF NOT EXISTS public.alerts (
    id TEXT PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "patientId" TEXT,
    "followUpTaskId" TEXT,
    "callId" TEXT,
    reason TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    "createdAt" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
    "resolvedAt" BIGINT,
    "resolutionNotes" TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_client ON public.alerts ("clientId", status);

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own alerts" ON public.alerts;
CREATE POLICY "Tenants can manage their own alerts" ON public.alerts
    FOR ALL USING (auth.uid()::text = "clientId");
