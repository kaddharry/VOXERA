-- =============================================================================
-- VOXERA — Consolidated, idempotent migration
-- =============================================================================
-- Merges sql/migration.sql through sql/migration_v11.sql into ONE script that
-- is safe to run against a completely fresh Supabase project, a partially
-- migrated one, or one that already has everything — every statement either
-- checks for existence first (CREATE TABLE/INDEX IF NOT EXISTS, ALTER TABLE
-- ADD COLUMN IF NOT EXISTS) or is naturally idempotent (CREATE OR REPLACE
-- FUNCTION). Existing data is never touched or dropped.
--
-- The only place this deliberately differs from the original migration.sql:
-- that file opened with `DROP TABLE IF EXISTS public.memories CASCADE;`
-- before creating it fresh — destructive and wrong for a script meant to be
-- safely re-run against a database that may already have real memory data.
-- This version creates memories IF NOT EXISTS instead, with every column
-- from every later migration already included, and patches older tables via
-- ALTER TABLE ADD COLUMN IF NOT EXISTS.
--
-- Run this entire file once in the Supabase SQL Editor. If you've already
-- run some of migration.sql..migration_v11.sql individually, running this
-- afterward is safe — every statement is a no-op for anything that already
-- matches.
-- =============================================================================

-- =============================================================================
-- 1. Extensions
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- 2. tenants — one row per signed-up account (migration_v2.sql)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    industry TEXT,
    timezone TEXT,
    plan TEXT DEFAULT 'trial',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own row" ON public.tenants;
CREATE POLICY "Tenants can manage their own row" ON public.tenants
    FOR ALL USING (auth.uid() = auth_user_id);

-- =============================================================================
-- 3. business_settings — one row per tenant (migration_v2/v6/v7/v9/v10.sql)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.business_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE NOT NULL,
    business_name TEXT NOT NULL,
    greeting TEXT,
    voice_persona TEXT,
    escalation_policy TEXT,
    call_goal TEXT,
    workflow_type TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Columns added across v6/v7/v9/v10 — patches older tables, no-op on new ones.
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS opening_time TEXT;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS closing_time TEXT;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS voice_provider TEXT;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS custom_voice_id TEXT;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS sms_recovery_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS sms_recovery_template TEXT
    DEFAULT 'Hi, we noticed you had a less than stellar experience today. Please let us make it up to you: {{link}}';
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS sms_recovery_link TEXT DEFAULT '';
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'English';
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS tone TEXT DEFAULT 'Professional';

ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own settings" ON public.business_settings;
CREATE POLICY "Tenants can manage their own settings" ON public.business_settings
    FOR ALL USING (
        tenant_id IN (SELECT id FROM public.tenants WHERE auth_user_id = auth.uid())
    );

-- =============================================================================
-- 4. agents — Agent Builder: multiple named agents per tenant
-- (migration_v2.sql base columns + migration_v11.sql prompt/voice columns)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    active_version_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Columns added in migration_v11.sql for Agent Builder's real prompt/voice/
-- greeting fields — this is very likely what's still missing if you're
-- seeing "Could not find the table" or column errors on agent creation.
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS system_prompt TEXT;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS greeting TEXT;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS voice_persona TEXT DEFAULT 'female-friendly';

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own agents" ON public.agents;
CREATE POLICY "Tenants can manage their own agents" ON public.agents
    FOR ALL USING (
        tenant_id IN (SELECT id FROM public.tenants WHERE auth_user_id = auth.uid())
    );

-- =============================================================================
-- 5. reservations (migration.sql base + migration_v5.sql customer columns)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.reservations (
  id text PRIMARY KEY,
  "userId" text NOT NULL,
  "clientId" text NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  date text NOT NULL,
  time text NOT NULL,
  "partySize" integer NOT NULL DEFAULT 1
);

ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS "customerName" text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS "customerEmail" text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS "customerPhone" text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS "calendarEventId" text;

CREATE INDEX IF NOT EXISTS idx_reservations_client_slot
ON public.reservations ("clientId", date, time, status);

-- Atomic booking function (migration_v5.sql) — advisory-locked to prevent
-- double-booking the same client/date/time slot under concurrency.
CREATE OR REPLACE FUNCTION create_reservation_atomic(
  p_booking_id text,
  p_user_id text,
  p_client_id text,
  p_date text,
  p_time text,
  p_party_size integer,
  p_cust_name text,
  p_cust_email text,
  p_cust_phone text
) RETURNS jsonb AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_client_id || '_' || p_date || '_' || p_time));

  SELECT count(*) INTO v_count
  FROM public.reservations
  WHERE "clientId" = p_client_id
    AND date = p_date
    AND time = p_time
    AND status = 'confirmed';

  IF v_count >= 2 THEN
    RAISE EXCEPTION 'Slot % at % is fully booked.', p_date, p_time;
  END IF;

  INSERT INTO public.reservations (
    id, "userId", "clientId", status, date, time, "partySize",
    "customerName", "customerEmail", "customerPhone"
  )
  VALUES (
    p_booking_id, p_user_id, p_client_id, 'confirmed', p_date, p_time, p_party_size,
    p_cust_name, p_cust_email, p_cust_phone
  );

  RETURN json_build_object(
    'id', p_booking_id,
    'userId', p_user_id,
    'clientId', p_client_id,
    'status', 'confirmed',
    'date', p_date,
    'time', p_time,
    'partySize', p_party_size,
    'customerName', p_cust_name,
    'customerEmail', p_cust_email,
    'customerPhone', p_cust_phone
  );
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 6. session_logs (migration.sql base + migration_v8.sql compound index)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.session_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts bigint NOT NULL,
  "sessionId" text NOT NULL,
  "userId" text NOT NULL,
  "clientId" text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_session_logs_session ON public.session_logs ("sessionId");
CREATE INDEX IF NOT EXISTS idx_session_logs_ts ON public.session_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_session_logs_client_ts ON public.session_logs ("clientId", ts DESC);

-- =============================================================================
-- 7. call_logs + phone_numbers (migration_v3.sql — telephony)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.call_logs (
  id text PRIMARY KEY,
  "clientId" text NOT NULL,
  "callerNumber" text,
  status text NOT NULL DEFAULT 'active',
  "startedAt" bigint NOT NULL,
  "endedAt" bigint,
  "durationMs" bigint,
  "sessionId" text,
  "queueWaitMs" bigint DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_call_logs_client ON public.call_logs ("clientId");
CREATE INDEX IF NOT EXISTS idx_call_logs_started ON public.call_logs ("startedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_session ON public.call_logs ("sessionId");

CREATE TABLE IF NOT EXISTS public.phone_numbers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "clientId" text NOT NULL,
  "phoneNumber" text NOT NULL UNIQUE,
  "friendlyName" text,
  active boolean NOT NULL DEFAULT true,
  "createdAt" bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);

-- migration_v12: default inbound agent per phone number
ALTER TABLE public.phone_numbers
ADD COLUMN IF NOT EXISTS "agentId" UUID REFERENCES public.agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_phone_numbers_agent ON public.phone_numbers ("agentId");

-- migration_v12: campaign bulk-calling
CREATE TABLE IF NOT EXISTS public.call_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId" text NOT NULL,
  "agentId" UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
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
  status text NOT NULL DEFAULT 'pending',
  "callSid" text,
  error text,
  "createdAt" bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  "completedAt" bigint
);

CREATE INDEX IF NOT EXISTS idx_campaign_calls_campaign ON public.campaign_calls ("campaignId");

CREATE INDEX IF NOT EXISTS idx_phone_numbers_client ON public.phone_numbers ("clientId");

-- =============================================================================
-- 8. knowledge_documents (migration_v4.sql) — must exist before memories'
-- documentId FK below. This is very likely the table causing the current
-- "Internal Server Error" on PDF/knowledge upload if it's missing.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.knowledge_documents (
  id text PRIMARY KEY,
  "clientId" text NOT NULL,
  filename text NOT NULL,
  "mimeType" text NOT NULL,
  status text NOT NULL,
  "chunkCount" integer NOT NULL DEFAULT 0,
  "errorMessage" text,
  version integer NOT NULL DEFAULT 1,
  "createdAt" bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_client ON public.knowledge_documents ("clientId");
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_created ON public.knowledge_documents ("createdAt" DESC);

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own knowledge documents" ON public.knowledge_documents;
CREATE POLICY "Tenants can manage their own knowledge documents" ON public.knowledge_documents
    FOR ALL USING (auth.uid()::text = "clientId");

-- =============================================================================
-- 9. memories — the vector store backing STM/MTM/LTM (migration.sql base,
-- deliberately created IF NOT EXISTS here rather than DROP+CREATE — see the
-- note at the top of this file)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.memories (
  id text PRIMARY KEY,
  tier text NOT NULL,
  "userId" text,
  "clientId" text NOT NULL,
  ts bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
  text text NOT NULL,
  summary text NOT NULL DEFAULT '',
  entities text[] NOT NULL DEFAULT '{}',
  topic text NOT NULL DEFAULT 'general',
  emotion text NOT NULL DEFAULT 'neutral',
  vad_v real NOT NULL DEFAULT 0,
  vad_a real NOT NULL DEFAULT 0,
  vad_d real NOT NULL DEFAULT 0,
  intensity real NOT NULL DEFAULT 0,
  importance real NOT NULL DEFAULT 0.5,
  importance_score real NOT NULL DEFAULT 0.5,
  retrieval_count integer NOT NULL DEFAULT 0,
  last_retrieved_at bigint,
  embedding vector(1536),
  "sourceUtteranceIds" text[] NOT NULL DEFAULT '{}',
  recurrence integer NOT NULL DEFAULT 1,
  resolved boolean NOT NULL DEFAULT false,
  ttl bigint
);

-- Patches for tables created before these columns existed (migration_v4.sql,
-- migration_v9.sql) — no-op if the table was just created fresh above.
-- IMPORTANT: CREATE TABLE IF NOT EXISTS above is a full no-op on a DB where
-- `memories` already exists under the original migration.sql schema (id,
-- tier, userId, clientId, text, embedding, metadata, createdAt, documentId,
-- importance_score, retrieval_count, last_retrieved_at only) — every column
-- below that isn't explicitly patched here silently never gets added, and
-- every write that sets it (lib/memory/store.ts's toRow()) then fails with
-- "Could not find the '<col>' column of 'memories' in the schema cache",
-- caught and only console.error'd by vectorStore.put() — so this list must
-- stay complete, not just the columns any one feature happened to need.
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS "documentId" text
    REFERENCES public.knowledge_documents(id) ON DELETE CASCADE;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS importance_score real NOT NULL DEFAULT 0.5;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS retrieval_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS last_retrieved_at bigint;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS ts bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS summary text NOT NULL DEFAULT '';
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS entities text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS topic text NOT NULL DEFAULT 'general';
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS emotion text NOT NULL DEFAULT 'neutral';
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS vad_v real NOT NULL DEFAULT 0;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS vad_a real NOT NULL DEFAULT 0;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS vad_d real NOT NULL DEFAULT 0;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS intensity real NOT NULL DEFAULT 0;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS importance real NOT NULL DEFAULT 0.5;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS "sourceUtteranceIds" text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS recurrence integer NOT NULL DEFAULT 1;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS resolved boolean NOT NULL DEFAULT false;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS ttl bigint;

CREATE INDEX IF NOT EXISTS idx_memories_tier_client ON public.memories (tier, "clientId");
CREATE INDEX IF NOT EXISTS idx_memories_user ON public.memories ("userId");
CREATE INDEX IF NOT EXISTS idx_memories_document ON public.memories ("documentId");

ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own memories" ON public.memories;
CREATE POLICY "Tenants can manage their own memories" ON public.memories
    FOR ALL USING (auth.uid()::text = "clientId");

-- Vector similarity search function — final shape from migration_v9.sql.
-- The argument list has been identical since migration.sql (only the
-- RETURNS TABLE columns grew in v9), but Postgres derives the function's
-- row type from those RETURNS TABLE / OUT-parameter columns and refuses to
-- change that shape via CREATE OR REPLACE — it errors with "cannot change
-- return type of existing function" if an older version (e.g. one created
-- before migration_v9.sql was applied, missing importance_score/
-- retrieval_count/last_retrieved_at) already exists. Dropping first by the
-- exact original argument signature makes this safe to run regardless of
-- which version, if any, is already there.
DROP FUNCTION IF EXISTS public.match_memories(vector, double precision, integer, text, text, text);
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_tier text,
  filter_client_id text,
  filter_user_id text DEFAULT NULL
)
RETURNS TABLE (
  id text,
  tier text,
  "userId" text,
  "clientId" text,
  ts bigint,
  text text,
  summary text,
  entities text[],
  topic text,
  emotion text,
  vad_v real,
  vad_a real,
  vad_d real,
  intensity real,
  importance real,
  importance_score real,
  retrieval_count integer,
  last_retrieved_at bigint,
  "sourceUtteranceIds" text[],
  recurrence integer,
  resolved boolean,
  ttl bigint,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.tier, m."userId", m."clientId", m.ts, m.text, m.summary, m.entities,
    m.topic, m.emotion, m.vad_v, m.vad_a, m.vad_d, m.intensity, m.importance,
    m.importance_score, m.retrieval_count, m.last_retrieved_at,
    m."sourceUtteranceIds", m.recurrence, m.resolved, m.ttl,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM public.memories m
  WHERE m.tier = filter_tier
    AND m."clientId" = filter_client_id
    AND (filter_user_id IS NULL OR m."userId" = filter_user_id)
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- =============================================================================
-- 10. tenant_credentials — encrypted third-party integration keys (migration_v8.sql)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tenant_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE NOT NULL,
    google_service_account_email TEXT,
    google_private_key TEXT,
    google_calendar_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.tenant_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own credentials" ON public.tenant_credentials;
CREATE POLICY "Tenants can manage their own credentials" ON public.tenant_credentials
    FOR ALL USING (
        tenant_id IN (SELECT id FROM public.tenants WHERE auth_user_id = auth.uid())
    );

-- =============================================================================
-- 11. call_logs / reservations RLS (migration_v8.sql — these two tables are
-- keyed by "clientId" rather than tenant_id like the rest of section 10/12)
-- =============================================================================
ALTER TABLE public.session_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own session logs" ON public.session_logs;
CREATE POLICY "Tenants can manage their own session logs" ON public.session_logs
    FOR ALL USING (auth.uid()::text = "clientId");

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own reservations" ON public.reservations;
CREATE POLICY "Tenants can manage their own reservations" ON public.reservations
    FOR ALL USING (auth.uid()::text = "clientId");

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own call logs" ON public.call_logs;
CREATE POLICY "Tenants can manage their own call logs" ON public.call_logs
    FOR ALL USING (auth.uid()::text = "clientId");

-- =============================================================================
-- 12. subscriptions — Stripe billing (migration_v10.sql, made idempotent —
-- the original had a bare CREATE TABLE with no IF NOT EXISTS guard)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id text PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id),
  stripe_customer_id text,
  stripe_subscription_id text,
  tier text NOT NULL DEFAULT 'starter',
  status text NOT NULL DEFAULT 'active',
  current_period_end bigint,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own tenant's subscriptions" ON public.subscriptions;
CREATE POLICY "Users can view their own tenant's subscriptions"
ON public.subscriptions
FOR SELECT
USING (
  tenant_id IN (SELECT id FROM public.tenants WHERE auth_user_id = auth.uid())
);

-- =============================================================================
-- Done. Sanity check — should list 11 tables:
-- tenants, business_settings, agents, reservations, session_logs, call_logs,
-- phone_numbers, knowledge_documents, memories, tenant_credentials, subscriptions
-- =============================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'tenants', 'business_settings', 'agents', 'reservations', 'session_logs',
    'call_logs', 'phone_numbers', 'knowledge_documents', 'memories',
    'tenant_credentials', 'subscriptions'
  )
ORDER BY table_name;
