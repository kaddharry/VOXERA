-- Migration v37: doctor portal — primary doctor per patient, appointment severity,
-- medications + adherence, doctor-to-doctor referrals, doctor→agent instruction requests
-- (admin-approved).
--
-- Doctors log in as tenant_members(role='clinician') linked to providers.user_id (v29).
-- They never touch these tables directly from the browser: every /api/doctor/* route runs
-- with the service role after resolving the doctor's own provider id and scoping by it.
-- The owner-only RLS policies below therefore only protect against direct-from-browser access.

-- ── Patients: the doctor who owns this patient's care ────────────────────────
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS "primaryProviderId" UUID;
CREATE INDEX IF NOT EXISTS idx_patients_primary_provider ON public.patients ("primaryProviderId");

-- ── Appointments: how serious is the visit, and who cancelled it ─────────────
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'routine'
    CHECK (severity IN ('routine', 'moderate', 'serious', 'emergency'));
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS severity_reason TEXT;
-- 0 (least important) .. 100 (most). Higher = keep; the doctor's list is sorted by it.
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS priority_score INTEGER NOT NULL DEFAULT 20;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cancelled_by_user_id UUID;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cancelled_by_role TEXT;

-- ── Medications a doctor prescribed + what the patient reported taking ───────
CREATE TABLE IF NOT EXISTS public.medications (
    id TEXT PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    "providerId" UUID,
    name TEXT NOT NULL,
    dosage TEXT,
    -- Free text the agent can read aloud: "twice a day after food".
    frequency TEXT NOT NULL DEFAULT 'once daily',
    "timesPerDay" INTEGER NOT NULL DEFAULT 1,
    instructions TEXT,
    "startDate" BIGINT NOT NULL,
    "endDate" BIGINT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped', 'completed')),
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_medications_patient ON public.medications ("patientId", status);
CREATE INDEX IF NOT EXISTS idx_medications_client ON public.medications ("clientId");

CREATE TABLE IF NOT EXISTS public.medication_adherence (
    id TEXT PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    "medicationId" TEXT NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
    "sessionId" TEXT,
    status TEXT NOT NULL CHECK (status IN ('taken', 'partial', 'missed', 'unknown')),
    note TEXT,
    source TEXT NOT NULL DEFAULT 'call' CHECK (source IN ('call', 'doctor', 'patient')),
    "reportedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adherence_patient ON public.medication_adherence ("patientId", "reportedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_adherence_med ON public.medication_adherence ("medicationId", "reportedAt" DESC);

-- ── Doctor → doctor referrals ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referrals (
    id TEXT PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    "patientId" TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    from_provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    to_provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    urgency TEXT NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine', 'soon', 'urgent')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'completed', 'cancelled')),
    response_note TEXT,
    appointment_id UUID,
    created_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    CONSTRAINT referrals_distinct_doctors CHECK (from_provider_id <> to_provider_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_to ON public.referrals (to_provider_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_from ON public.referrals (from_provider_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_client ON public.referrals ("clientId");

-- ── Doctor instructions for the voice agent (need hospital-admin approval) ───
CREATE TABLE IF NOT EXISTS public.agent_instruction_requests (
    id TEXT PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    requested_by_user_id UUID,
    -- NULL = applies to every patient of this doctor; set = one patient only.
    "patientId" TEXT REFERENCES public.patients(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    doctor_message TEXT NOT NULL,       -- what the doctor typed in the chatbot
    proposed_instruction TEXT NOT NULL, -- the cleaned-up instruction the agent would follow
    transcript JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
    reviewed_by_user_id UUID,
    review_note TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_air_client_status ON public.agent_instruction_requests ("clientId", status);
CREATE INDEX IF NOT EXISTS idx_air_provider ON public.agent_instruction_requests (provider_id, status);
CREATE INDEX IF NOT EXISTS idx_air_patient ON public.agent_instruction_requests ("patientId") WHERE status = 'approved';

-- ── RLS: tenant owner only; doctors go through server routes ─────────────────
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_adherence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_instruction_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenants can manage their own medications" ON public.medications;
CREATE POLICY "Tenants can manage their own medications" ON public.medications
    FOR ALL USING (auth.uid()::text = "clientId");
DROP POLICY IF EXISTS "Tenants can manage their own adherence" ON public.medication_adherence;
CREATE POLICY "Tenants can manage their own adherence" ON public.medication_adherence
    FOR ALL USING (auth.uid()::text = "clientId");
DROP POLICY IF EXISTS "Tenants can manage their own referrals" ON public.referrals;
CREATE POLICY "Tenants can manage their own referrals" ON public.referrals
    FOR ALL USING (auth.uid()::text = "clientId");
DROP POLICY IF EXISTS "Tenants can manage their own instruction requests" ON public.agent_instruction_requests;
CREATE POLICY "Tenants can manage their own instruction requests" ON public.agent_instruction_requests
    FOR ALL USING (auth.uid()::text = "clientId");
