-- VOXERA: Full Database Migration Script
-- Run this ENTIRE script in your Supabase SQL Editor.
-- It will set up all tables needed for the platform.

-- =============================================================
-- 1. Enable pgvector extension
-- =============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================
-- 2. Drop old memories table if it exists (clean slate)
-- =============================================================
DROP TABLE IF EXISTS public.memories CASCADE;

-- =============================================================
-- 3. Create memories table with proper columns
-- =============================================================
CREATE TABLE public.memories (
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
  embedding vector(1536),
  "sourceUtteranceIds" text[] NOT NULL DEFAULT '{}',
  recurrence integer NOT NULL DEFAULT 1,
  resolved boolean NOT NULL DEFAULT false,
  ttl bigint
);

-- Index for fast tier+client lookups
CREATE INDEX idx_memories_tier_client ON public.memories (tier, "clientId");
-- Index for fast user lookups
CREATE INDEX idx_memories_user ON public.memories ("userId");

-- =============================================================
-- 4. Create vector similarity search function
-- =============================================================
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
    m.id,
    m.tier,
    m."userId",
    m."clientId",
    m.ts,
    m.text,
    m.summary,
    m.entities,
    m.topic,
    m.emotion,
    m.vad_v,
    m.vad_a,
    m.vad_d,
    m.intensity,
    m.importance,
    m."sourceUtteranceIds",
    m.recurrence,
    m.resolved,
    m.ttl,
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

-- =============================================================
-- 5. Ensure reservations table exists
-- =============================================================
CREATE TABLE IF NOT EXISTS public.reservations (
  id text PRIMARY KEY,
  "userId" text NOT NULL,
  "clientId" text NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  date text NOT NULL,
  time text NOT NULL,
  "partySize" integer NOT NULL DEFAULT 1
);

-- =============================================================
-- 6. Ensure session_logs table exists
-- =============================================================
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
