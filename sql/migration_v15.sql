-- Migration v15: RLS backstop for phone_numbers, call_campaigns,
-- campaign_calls and patients.
--
-- These four tables were clientId-scoped by API routes only, with no
-- database-level policy enforcing it (every other clientId-scoped table —
-- call_logs, session_logs, reservations, knowledge_documents, memories —
-- already has an equivalent policy). A route bug or a missed filter would
-- have had no backstop. campaign_calls has no clientId column of its own,
-- so its policy scopes through the owning call_campaigns row instead.

ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own phone numbers" ON public.phone_numbers;
CREATE POLICY "Tenants can manage their own phone numbers" ON public.phone_numbers
    FOR ALL USING (auth.uid()::text = "clientId");

ALTER TABLE public.call_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own campaigns" ON public.call_campaigns;
CREATE POLICY "Tenants can manage their own campaigns" ON public.call_campaigns
    FOR ALL USING (auth.uid()::text = "clientId");

ALTER TABLE public.campaign_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage calls in their own campaigns" ON public.campaign_calls;
CREATE POLICY "Tenants can manage calls in their own campaigns" ON public.campaign_calls
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.call_campaigns
            WHERE call_campaigns.id = campaign_calls."campaignId"
            AND auth.uid()::text = call_campaigns."clientId"
        )
    );

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own patients" ON public.patients;
CREATE POLICY "Tenants can manage their own patients" ON public.patients
    FOR ALL USING (auth.uid()::text = "clientId");
