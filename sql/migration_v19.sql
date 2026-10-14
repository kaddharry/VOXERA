-- Migration v19: Minimal reusable follow-up programme templates.
--
-- Spec §10.1/§19 Batch 4 explicitly scopes the first release to "individual
-- schedules plus a MINIMAL reusable template model" — not a full clinical
-- pathway authoring system. A programme is just a named, ordered list of
-- day-offsets (e.g. post-discharge day 1/3/7) sharing one retry policy;
-- enrolling a patient creates one follow_up_tasks row per step (see
-- lib/db/follow-up-programmes.ts's enrollPatientInProgramme), each a plain
-- individual task from then on — the programme itself is never consulted
-- again by the dispatcher, so editing a programme template can't silently
-- change an already-scheduled patient's calls (spec §16.6's "must be
-- versioned or snapshotted enough that edits don't silently change already
-- scheduled calls" — satisfied here by never re-reading the template after
-- enrollment, the simplest possible form of that guarantee).

CREATE TABLE IF NOT EXISTS public.follow_up_programmes (
    id TEXT PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    -- Ordered list of steps: [{"dayOffset": 1, "label": "Day 1 check-in"}, ...]
    -- dayOffset is whole days after the enrollment date, in the patient's
    -- local timezone at enrollment time.
    steps JSONB NOT NULL,
    "agentId" TEXT,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "retryDelayMinutes" INTEGER NOT NULL DEFAULT 30,
    "windowStartMinute" INTEGER,
    "windowEndMinute" INTEGER,
    "createdAt" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);

CREATE INDEX IF NOT EXISTS idx_follow_up_programmes_client ON public.follow_up_programmes ("clientId");

ALTER TABLE public.follow_up_programmes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own follow-up programmes" ON public.follow_up_programmes;
CREATE POLICY "Tenants can manage their own follow-up programmes" ON public.follow_up_programmes
    FOR ALL USING (auth.uid()::text = "clientId");

-- Links a follow_up_tasks row back to the programme (and which step) it
-- was generated from, for display only — never read by the dispatcher.
ALTER TABLE public.follow_up_tasks ADD COLUMN IF NOT EXISTS "programmeId" TEXT;
ALTER TABLE public.follow_up_tasks ADD COLUMN IF NOT EXISTS "programmeStepLabel" TEXT;
