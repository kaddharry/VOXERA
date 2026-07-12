-- Migration v9: Business Operating Hours + Adaptive Memory Scoring + RAG Explainability

-- Sprint 5: Business Operating Hours
ALTER TABLE public.business_settings
ADD COLUMN IF NOT EXISTS opening_time TEXT;

ALTER TABLE public.business_settings
ADD COLUMN IF NOT EXISTS closing_time TEXT;

-- Adaptive memory scoring fields
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS importance_score real NOT NULL DEFAULT 0.5;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS retrieval_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS last_retrieved_at bigint;

-- Redefine match_memories to return the new fields
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
    m.importance_score,
    m.retrieval_count,
    m.last_retrieved_at,
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
