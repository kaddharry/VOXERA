-- Migration v31: Appointment reminders + waitlist backfill.
--
-- Reminder calls (72h/24h/2h before a visit) reuse follow_up_tasks and its
-- dispatch loop (lib/scheduler/dispatcher.ts) as-is — that loop is already
-- timezone-aware, race-safe (compare-and-swap claim), retry-policy-driven,
-- and doNotContact-aware. An appointment reminder is just "call this
-- patient at time X", with "kind"/"appointmentId" added so it's additive,
-- not a parallel scheduler.
--
-- appointment_waitlist is a separate, durable table (not another
-- follow_up_tasks row) because a waitlist entry represents a standing want
-- ("any opening with Dr. Desai in the next 2 weeks") that persists with no
-- call currently scheduled — a follow_up_tasks row only exists transiently,
-- the moment a backfill call actually needs to go out (kind='waitlist_offer').

ALTER TABLE public.follow_up_tasks ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'manual'
    CHECK ("kind" IN ('manual', 'appointment_reminder', 'waitlist_offer'));
ALTER TABLE public.follow_up_tasks ADD COLUMN IF NOT EXISTS "appointmentId" UUID
    REFERENCES public.appointments(id) ON DELETE CASCADE;
ALTER TABLE public.follow_up_tasks ADD COLUMN IF NOT EXISTS "waitlistId" UUID;

CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_appointment ON public.follow_up_tasks ("appointmentId");

CREATE TABLE IF NOT EXISTS public.appointment_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES public.providers(id) ON DELETE CASCADE,
  desired_visit_type TEXT,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'offered', 'booked', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_provider_open ON public.appointment_waitlist (provider_id, status);

ALTER TABLE public.appointment_waitlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own waitlist" ON public.appointment_waitlist;
CREATE POLICY "Tenants can manage their own waitlist" ON public.appointment_waitlist
    FOR ALL USING (auth.uid()::text = client_id);

ALTER TABLE public.follow_up_tasks DROP CONSTRAINT IF EXISTS fk_follow_up_tasks_waitlist;
ALTER TABLE public.follow_up_tasks ADD CONSTRAINT fk_follow_up_tasks_waitlist
    FOREIGN KEY ("waitlistId") REFERENCES public.appointment_waitlist(id) ON DELETE CASCADE NOT VALID;
