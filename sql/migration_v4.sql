-- VOXERA: Sprint 3 - Knowledge Base Management Migration
-- Run this in your Supabase SQL Editor AFTER migration_v3.sql

-- =============================================================
-- knowledge_documents table — tracks document metadata (FR-16)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.knowledge_documents (
  id text PRIMARY KEY,
  "clientId" text NOT NULL,
  filename text NOT NULL,
  "mimeType" text NOT NULL,
  status text NOT NULL,                 -- 'processing' | 'ready' | 'failed' | 'superseded'
  "chunkCount" integer NOT NULL DEFAULT 0,
  "errorMessage" text,
  version integer NOT NULL DEFAULT 1,
  "createdAt" bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);

-- Index for dashboard queries
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_client ON public.knowledge_documents ("clientId");
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_created ON public.knowledge_documents ("createdAt" DESC);

-- =============================================================
-- Add documentId to memories table (references knowledge_documents)
-- =============================================================
ALTER TABLE public.memories 
ADD COLUMN IF NOT EXISTS "documentId" text REFERENCES public.knowledge_documents(id) ON DELETE CASCADE;

-- Index for fast lookup by document
CREATE INDEX IF NOT EXISTS idx_memories_document ON public.memories ("documentId");
