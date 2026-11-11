-- Migration v30: Clinical appointments.
--
-- public.reservations (migration_v5.sql+) is a restaurant-booking-shaped
-- table — free-text "date"/"time" strings (flagged as a real limitation in
-- app/api/analytics/route.ts, which can't do date-range queries on it),
-- no provider, no visit type, no duration. It stays as-is for the legacy
-- demo booking flow; appointments is a new, properly-shaped table for real
-- clinical scheduling, with real timestamptz columns and overlap-aware
-- (not just exact-slot) double-booking prevention, since a 30-minute
-- follow-up must not land inside an already-booked 45-minute consult.
--
-- Scoped by "client_id" (= tenants.auth_user_id) rather than tenant_id,
-- matching patients/reservations/follow_up_tasks' existing, working RLS
-- idiom exactly (auth.uid()::text = client_id) — tenant_id is carried too,
-- forward-looking, but RLS keys off client_id like its sibling tables.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE RESTRICT,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  visit_type TEXT NOT NULL DEFAULT 'consultation'
      CHECK (visit_type IN ('consultation', 'follow_up', 'procedure', 'telehealth', 'other')),
  status TEXT NOT NULL DEFAULT 'scheduled'
      CHECK (status IN ('scheduled', 'confirmed', 'checked_in', 'completed', 'no_show', 'cancelled')),
  notes TEXT,
  booked_via TEXT NOT NULL DEFAULT 'staff' CHECK (booked_via IN ('staff', 'ai_call')),
  booked_by_session_id TEXT,
  created_by_user_id UUID REFERENCES auth.users(id),
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  -- Links to the follow_up_tasks rows (migration_v31.sql) this appointment
  -- owns, so cancelling/rescheduling it can bulk-cancel its pending
  -- reminder calls directly instead of searching for them.
  reminder_72h_task_id TEXT,
  reminder_24h_task_id TEXT,
  reminder_2h_task_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT appointments_time_valid CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_appointments_provider_time ON public.appointments (provider_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON public.appointments (patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_client_time ON public.appointments (client_id, starts_at);
-- Backs both the atomic booking functions' overlap check and the UI's own
-- range queries; excludes cancelled/no_show so a freed slot shows as open.
CREATE INDEX IF NOT EXISTS idx_appointments_provider_active_range
    ON public.appointments USING gist (provider_id, tstzrange(starts_at, ends_at))
    WHERE status NOT IN ('cancelled', 'no_show');

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own appointments" ON public.appointments;
CREATE POLICY "Tenants can manage their own appointments" ON public.appointments
    FOR ALL USING (auth.uid()::text = client_id);

-- Atomic, overlap-safe booking — advisory-locked per provider (not per
-- exact slot like create_reservation_atomic in migration_v5.sql), so two
-- concurrent booking attempts for the same provider can't both succeed
-- even if their time ranges only partially overlap.
CREATE OR REPLACE FUNCTION public.book_appointment_atomic(
  p_tenant_id UUID,
  p_client_id TEXT,
  p_provider_id UUID,
  p_patient_id TEXT,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_visit_type TEXT,
  p_notes TEXT,
  p_booked_via TEXT,
  p_booked_by_session_id TEXT,
  p_created_by_user_id UUID
) RETURNS public.appointments AS $$
DECLARE
  v_conflicts INTEGER;
  v_row public.appointments;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_provider_id::text));

  SELECT count(*) INTO v_conflicts
  FROM public.appointments
  WHERE provider_id = p_provider_id
    AND status NOT IN ('cancelled', 'no_show')
    AND tstzrange(starts_at, ends_at) && tstzrange(p_starts_at, p_ends_at);

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'Provider % already has an overlapping appointment in that window.', p_provider_id
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.appointments (
    tenant_id, client_id, provider_id, patient_id, starts_at, ends_at,
    visit_type, status, notes, booked_via, booked_by_session_id, created_by_user_id
  ) VALUES (
    p_tenant_id, p_client_id, p_provider_id, p_patient_id, p_starts_at, p_ends_at,
    p_visit_type, 'scheduled', p_notes, p_booked_via, p_booked_by_session_id, p_created_by_user_id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- Reschedule: same overlap check, excluding the appointment's own current row.
CREATE OR REPLACE FUNCTION public.reschedule_appointment_atomic(
  p_appointment_id UUID,
  p_client_id TEXT,
  p_new_starts_at TIMESTAMPTZ,
  p_new_ends_at TIMESTAMPTZ
) RETURNS public.appointments AS $$
DECLARE
  v_provider_id UUID;
  v_conflicts INTEGER;
  v_row public.appointments;
BEGIN
  SELECT provider_id INTO v_provider_id FROM public.appointments
    WHERE id = p_appointment_id AND client_id = p_client_id;
  IF v_provider_id IS NULL THEN
    RAISE EXCEPTION 'Appointment not found or permission denied.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_provider_id::text));

  SELECT count(*) INTO v_conflicts
  FROM public.appointments
  WHERE provider_id = v_provider_id
    AND id <> p_appointment_id
    AND status NOT IN ('cancelled', 'no_show')
    AND tstzrange(starts_at, ends_at) && tstzrange(p_new_starts_at, p_new_ends_at);

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'Provider already has an overlapping appointment in that window.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.appointments
    SET starts_at = p_new_starts_at, ends_at = p_new_ends_at, status = 'scheduled', updated_at = NOW()
    WHERE id = p_appointment_id
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql;
