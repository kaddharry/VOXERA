-- Migration v22: link alerts directly to the session that caused them, and
-- let a single "call this patient every day in a date range" schedule be
-- tracked/cancelled as one group.
--
-- Alerts previously carried followUpTaskId/callId but never sessionId, so
-- there was no reliable way to jump from an alert straight to the call's
-- transcript/emotion timeline — the UI either linked to the generic
-- patients list or didn't link anywhere. See lib/db/alerts.ts and
-- lib/scheduler/dispatcher.ts for the write paths this backs.

ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS "sessionId" TEXT;

CREATE INDEX IF NOT EXISTS idx_alerts_session ON public.alerts ("sessionId");

-- Groups every follow_up_tasks row created by one "call daily from date A to
-- date B" schedule, so they can be listed/cancelled together instead of only
-- as N independent single-day tasks. Null for a plain single-call or
-- programme-template schedule (unchanged behaviour).
ALTER TABLE public.follow_up_tasks ADD COLUMN IF NOT EXISTS "rangeGroupId" TEXT;

CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_range_group ON public.follow_up_tasks ("rangeGroupId");
