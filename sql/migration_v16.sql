-- Migration v16: Hospital membership + role model.
--
-- Today, "tenant" and "auth user" are 1:1 (tenants.auth_user_id) and there
-- is no role concept anywhere — every authenticated user is an implicit
-- full admin of their own tenant's data (see the redesign-spec audit).
-- This introduces a membership table decoupling "who can access tenant X"
-- from "who owns tenant X", so a hospital can eventually invite multiple
-- staff with different roles without changing every other table's scoping.
--
-- Existing clientId/tenantId scoping on other tables is untouched by this
-- migration — this only adds the membership/role layer on top. A later
-- batch (Team & Settings) will build the invite UI on top of this table;
-- for now every existing tenant is backfilled with its current owner as
-- 'hospital_admin' so nothing currently working changes behavior.

CREATE TABLE IF NOT EXISTS public.tenant_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('hospital_admin', 'care_coordinator', 'clinician', 'auditor')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON public.tenant_members (user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant ON public.tenant_members (tenant_id);

ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read their own memberships" ON public.tenant_members;
CREATE POLICY "Users can read their own memberships" ON public.tenant_members
    FOR SELECT USING (auth.uid() = user_id);

-- Hospital admins can manage membership rows for their own tenant (invite /
-- change role / remove staff). Scoped through the tenants table's own
-- auth_user_id ownership rather than a role check here, since this table
-- IS the role source — a non-owner hospital_admin row is not yet possible
-- (no invite UI exists), so this intentionally stays tied to tenant
-- ownership until the invite flow is built.
DROP POLICY IF EXISTS "Tenant owners can manage their memberships" ON public.tenant_members;
CREATE POLICY "Tenant owners can manage their memberships" ON public.tenant_members
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.tenants
            WHERE tenants.id = tenant_members.tenant_id
            AND tenants.auth_user_id = auth.uid()
        )
    );

-- Backfill: every existing tenant owner becomes that tenant's hospital_admin.
INSERT INTO public.tenant_members (tenant_id, user_id, role)
SELECT id, auth_user_id, 'hospital_admin'
FROM public.tenants
WHERE auth_user_id IS NOT NULL
ON CONFLICT (tenant_id, user_id) DO NOTHING;
