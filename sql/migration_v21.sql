-- Migration v21: Consent / do-not-contact enforcement (spec §17.4 — an
-- explicit release blocker, not polish: "Do not allow retries to bypass a
-- stop/opt-out state").
--
-- Every patient-linked call path (the scheduler's dispatcher, the manual
-- "Call Now" button) must check this before dialing, not just the UI
-- hiding a button — see lib/scheduler/dispatcher.ts and
-- app/api/admin/patients/[id]/call/route.ts.

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS "doNotContact" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS "doNotContactAt" BIGINT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS "doNotContactReason" TEXT;

CREATE INDEX IF NOT EXISTS idx_patients_do_not_contact ON public.patients ("clientId", "doNotContact");
