-- Migration v14: Patient roster + per-call summaries
--
-- Adds a patients table for the hospital-aftercare (and other check-in-call)
-- use case: a tenant maintains a roster of people to call, each with free-
-- text context injected into their calls (lib/agent/context.ts's new
-- "PATIENT CONTEXT" block) and an assigned agent. Scoped by "clientId"
-- (auth_user_id) directly, matching call_logs/memories/knowledge_documents'
-- existing convention — not agents' tenant_id indirection, since patients
-- are a clientId-scoped resource like those, not another agents-style
-- tenant-relationship table.
--
-- Also adds patientId/summary to call_logs so a call can be attributed to a
-- roster patient and carry its post-call LLM-generated summary.

CREATE TABLE IF NOT EXISTS public.patients (
  id text PRIMARY KEY,
  "clientId" text NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  notes text NOT NULL DEFAULT '',
  "assignedAgentId" text,
  "nextCheckInAt" bigint,
  "createdAt" bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);

CREATE INDEX IF NOT EXISTS idx_patients_client ON public.patients ("clientId");

ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS "patientId" text;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS summary jsonb;

CREATE INDEX IF NOT EXISTS idx_call_logs_patient ON public.call_logs ("patientId");
