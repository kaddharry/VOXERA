-- Migration v13: Switch embeddings from 1536-dim to 384-dim (local ONNX embedder)
--
-- lib/util/embed.ts previously used OpenAI's text-embedding-3-small (1536-dim)
-- when OPENAI_API_KEY was set, and otherwise silently fell back to a
-- bag-of-words hash embedder — which has no real semantic signal (cosine
-- similarity driven by literal token overlap). Since OPENAI_API_KEY was
-- never actually configured in this deployment, every stored embedding to
-- date is a hash-embedder vector, not a real semantic one — this is why RAG
-- retrieval kept surfacing the same few knowledge chunks regardless of query
-- topic (a proper noun/brand token repeated across many chunks dominates the
-- hash similarity, flattening the ranking).
--
-- Switched the app to a real local ONNX embedder (Xenova/bge-small-en-v1.5,
-- 384-dim, see lib/util/local-embedder.ts) that runs in-process with no
-- network dependency. pgvector columns are fixed-dimension, so the column
-- must be dropped and recreated rather than ALTERed in place — existing
-- embedding data is discarded (it was low-quality hash vectors regardless;
-- see the one-off re-embedding script run alongside this migration, which
-- regenerates real embeddings for all existing memory rows from their
-- stored `text`).

ALTER TABLE public.memories DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.memories ADD COLUMN embedding vector(384);

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(384),
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
