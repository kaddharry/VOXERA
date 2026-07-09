-- SQL Migration: Core Database Security & Hardening

-- =============================================================
-- 1. Enable Row Level Security (RLS) on public tables
-- =============================================================
ALTER TABLE public.session_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- 2. Create RLS policies using clientId
-- =============================================================
CREATE POLICY "Tenants can manage their own session logs" ON public.session_logs
    FOR ALL USING (auth.uid()::text = "clientId");

CREATE POLICY "Tenants can manage their own reservations" ON public.reservations
    FOR ALL USING (auth.uid()::text = "clientId");

CREATE POLICY "Tenants can manage their own memories" ON public.memories
    FOR ALL USING (auth.uid()::text = "clientId");

CREATE POLICY "Tenants can manage their own knowledge documents" ON public.knowledge_documents
    FOR ALL USING (auth.uid()::text = "clientId");

CREATE POLICY "Tenants can manage their own call logs" ON public.call_logs
    FOR ALL USING (auth.uid()::text = "clientId");

-- =============================================================
-- 3. Create tenant_credentials table for third-party integrations
-- =============================================================
CREATE TABLE IF NOT EXISTS public.tenant_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE NOT NULL,
    google_service_account_email TEXT,
    google_private_key TEXT, -- Encrypted at rest using AES-256-GCM
    google_calendar_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS and add policy for credentials
ALTER TABLE public.tenant_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants can manage their own credentials" ON public.tenant_credentials
    FOR ALL USING (
        tenant_id IN (
            SELECT id FROM public.tenants WHERE auth_user_id = auth.uid()
        )
    );

-- =============================================================
-- 4. Add Compound Indexes for analytics and bookings (Issue #12)
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_session_logs_client_ts 
ON public.session_logs ("clientId", ts DESC);

CREATE INDEX IF NOT EXISTS idx_reservations_client_slot 
ON public.reservations ("clientId", date, time, status);
