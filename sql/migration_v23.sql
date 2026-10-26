-- Migration v23: planned date/time per follow-up day, and soft-clearing of
-- past schedules.
--
-- A date-range schedule is stored as one follow_up_tasks row per day,
-- linked by "rangeGroupId" (migration_v22.sql). Each row's
-- "nextAttemptAt" is overwritten on every retry, so after a retry the row
-- no longer says which day and time were originally planned. The schedule
-- view ("configured schedule" vs. "what actually happened") and the
-- "edit future days" rules both need that, so it's stored separately here,
-- once, at creation:
--
--   "scheduledDate"   planned calendar day in the task's own timezone,
--                     'YYYY-MM-DD'. Day-locking ("today can't be edited")
--                     compares against this.
--   "scheduledMinute" planned call time, minutes since local midnight
--                     (600 = 10:00). Never changed by retries.
--
-- "archivedAt" marks rows hidden by "Clear past schedules". Nothing is
-- deleted: the task rows, and the call_logs / transcripts / summaries /
-- alerts that reference them, all stay in the database. Only finished
-- schedules are ever archived (enforced in the API, see
-- lib/scheduler/schedules.ts).
--
-- All three columns are nullable and additive, so existing code keeps
-- working before and after this runs.

ALTER TABLE public.follow_up_tasks ADD COLUMN IF NOT EXISTS "scheduledDate" TEXT;
ALTER TABLE public.follow_up_tasks ADD COLUMN IF NOT EXISTS "scheduledMinute" INTEGER;
ALTER TABLE public.follow_up_tasks ADD COLUMN IF NOT EXISTS "archivedAt" BIGINT;

-- Best-effort backfill for existing rows, from "nextAttemptAt" in each row's
-- timezone. Exact for days that haven't been attempted yet; for a day that
-- was already retried this gives the latest attempt's time rather than the
-- original plan (the original was never stored). Rows with a timezone
-- Postgres doesn't recognise are left NULL; the app falls back to
-- "nextAttemptAt" for those.
UPDATE public.follow_up_tasks t
SET
  "scheduledDate" = to_char(to_timestamp(t."nextAttemptAt" / 1000.0) AT TIME ZONE t.timezone, 'YYYY-MM-DD'),
  "scheduledMinute" =
    (extract(hour FROM to_timestamp(t."nextAttemptAt" / 1000.0) AT TIME ZONE t.timezone) * 60
      + extract(minute FROM to_timestamp(t."nextAttemptAt" / 1000.0) AT TIME ZONE t.timezone))::int
WHERE t."scheduledDate" IS NULL
  AND t.timezone IN (SELECT name FROM pg_timezone_names);

-- The Follow-ups panel lists a patient's non-archived tasks.
CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_patient_archived
  ON public.follow_up_tasks ("patientId", "archivedAt");
