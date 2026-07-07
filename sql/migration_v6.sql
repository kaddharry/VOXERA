-- Migration v6: Persistent STM sessions + infrastructure improvements
-- Issue #5: Short-term memory stored in local process memory causing session loss

-- Persistent short-term memory storage
-- Replaces the in-process Map<sessionId, Utterance[]> with a database-backed store
CREATE TABLE IF NOT EXISTS public.stm_sessions (
  session_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  utterances JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE INDEX idx_stm_sessions_updated ON public.stm_sessions (updated_at);
CREATE INDEX idx_stm_sessions_client ON public.stm_sessions (client_id);

-- Cleanup function: delete sessions older than 24 hours
CREATE OR REPLACE FUNCTION cleanup_stale_stm_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.stm_sessions
  WHERE updated_at < (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT - 86400000;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
