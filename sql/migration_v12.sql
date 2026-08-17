-- Migration v12: Default inbound agent per phone number
--
-- phone_numbers previously had no way to say which agent should handle a
-- call to a given number — /api/telephony/incoming resolved only clientId
-- (the tenant), so every inbound call always used the orchestrator's
-- hardcoded default prompt regardless of how many custom agents (see
-- migration_v11) a tenant had built. This adds an optional agentId column;
-- when set, the incoming-call webhook passes it through to the media
-- stream so the call is handled by that specific agent's prompt/knowledge
-- base instead of the tenant default. ON DELETE SET NULL rather than
-- CASCADE — deleting an agent shouldn't silently delete the phone number
-- routing record, just fall back to the tenant default again.

ALTER TABLE public.phone_numbers
ADD COLUMN IF NOT EXISTS "agentId" UUID REFERENCES public.agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_phone_numbers_agent ON public.phone_numbers ("agentId");

-- Bulk outbound calling — a campaign is a named batch of recipients dialed
-- with a specific agent; campaign_calls tracks per-recipient status
-- (pending/calling/completed/failed) so progress and failures are visible
-- while a campaign is still running, not just at the end.

CREATE TABLE IF NOT EXISTS public.call_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId" text NOT NULL,
  "agentId" UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | running | completed
  "totalRecipients" integer NOT NULL DEFAULT 0,
  "completedCount" integer NOT NULL DEFAULT 0,
  "failedCount" integer NOT NULL DEFAULT 0,
  "createdAt" bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  "completedAt" bigint
);

CREATE INDEX IF NOT EXISTS idx_call_campaigns_client ON public.call_campaigns ("clientId");

CREATE TABLE IF NOT EXISTS public.campaign_calls (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "campaignId" UUID NOT NULL REFERENCES public.call_campaigns(id) ON DELETE CASCADE,
  "phoneNumber" text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | calling | completed | failed
  "callSid" text,
  error text,
  "createdAt" bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  "completedAt" bigint
);

CREATE INDEX IF NOT EXISTS idx_campaign_calls_campaign ON public.campaign_calls ("campaignId");
