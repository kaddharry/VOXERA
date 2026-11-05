-- Migration v29: Providers (doctors/clinicians) + per-agent tool allowlist.
--
-- The appointment calendar needs a clinical identity to put on the
-- schedule ("Dr. Priya Desai, Cardiologist") that does NOT require that
-- doctor to have a Supabase auth login — most doctors won't have one on
-- day one, and booking in this build is AI-agent/front-desk-only (no
-- patient self-service portal), so a login isn't needed for the calendar
-- to be useful. tenant_members.role='clinician' (migration_v16.sql)
-- requires a NOT NULL auth.users link and has no invite UI yet, so it's
-- the wrong fit here — this is a separate, lighter table, with an
-- *optional* link to auth.users for the doctors who do want to log in
-- later.
--
-- Also adds agents."enabledTools": today lib/agent/orchestrator.ts's
-- `useTools: !resolvedAgent` means every custom Agent Builder agent gets
-- zero tools, unconditionally — only the hardcoded legacy/demo call path
-- has tools on. Appointment-booking tools (migration_v30.sql onward) need
-- a real agent to actually be able to call them, so this adds an explicit
-- per-agent allowlist. Defaulting to '{}' exactly preserves today's
-- behavior for every existing agent (no tools) until a hospital admin
-- opts a specific agent into specific tools via the Agent Builder UI.

CREATE TABLE IF NOT EXISTS public.providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  specialty TEXT,
  photo_url TEXT,
  -- Stable per-provider tint for calendar chips/avatars/cards — assigned
  -- once at creation (see lib/db/providers.ts), not re-derived per render,
  -- so a doctor's color stays consistent across the whole UI.
  color TEXT NOT NULL DEFAULT '#A78BFA',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  default_slot_minutes INTEGER NOT NULL DEFAULT 30,
  -- e.g. {"mon":[["09:00","13:00"],["14:00","18:00"]]}. NULL-tolerant in
  -- v1: no working hours set means "always bookable", so this never blocks
  -- booking before the hospital has configured anything.
  working_hours JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_providers_tenant ON public.providers (tenant_id);

ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own providers" ON public.providers;
CREATE POLICY "Tenants can manage their own providers" ON public.providers
    FOR ALL USING (
        tenant_id IN (SELECT id FROM public.tenants WHERE auth_user_id = auth.uid())
    );

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS "enabledTools" TEXT[] NOT NULL DEFAULT '{}';
