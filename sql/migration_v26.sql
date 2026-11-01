-- Migration v26: suggestions and agent versions for the self-learning pipeline.
--
-- Builds on migration_v25.sql (call_insights). The hospital reviews
-- suggestions made from repeated findings across calls:
--   * add_knowledge: patients keep asking something the agent can't answer
--     — the owner writes the answer, which is added to the knowledge base.
--   * prompt_change: the agent keeps making the same mistake (emotional
--     failure points) — a guideline is added to the agent's instructions.
-- Every accepted prompt change creates a new agent version, so the owner
-- can see what changed and why, and go back to an earlier version.

CREATE TABLE IF NOT EXISTS public.agent_suggestions (
    id TEXT PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "agentId" TEXT,                        -- prompt changes: the agent to change; knowledge is per account
    kind TEXT NOT NULL CHECK (kind IN ('add_knowledge', 'prompt_change')),
    "groupKey" TEXT NOT NULL,              -- add_knowledge: the topic; prompt_change: a short slug of the guideline
    title TEXT NOT NULL,
    explanation TEXT NOT NULL,             -- plain-language "why", with how often it happened
    proposal TEXT NOT NULL,                -- add_knowledge: the questions patients asked; prompt_change: the guideline to add
    evidence JSONB NOT NULL DEFAULT '[]',  -- call_insights ids + quotes behind it
    occurrences INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
    "resultVersion" INTEGER,               -- prompt_change: the agent version it created
    "createdAt" BIGINT NOT NULL,
    "resolvedAt" BIGINT
);

-- One live suggestion per topic/guideline: regenerating updates its counts
-- instead of duplicating it, and a dismissed one isn't proposed again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_suggestions_group ON public.agent_suggestions ("clientId", kind, COALESCE("agentId", ''), "groupKey");
CREATE INDEX IF NOT EXISTS idx_agent_suggestions_client ON public.agent_suggestions ("clientId", status);

ALTER TABLE public.agent_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own suggestions" ON public.agent_suggestions;
CREATE POLICY "Tenants can manage their own suggestions" ON public.agent_suggestions
    FOR ALL USING (auth.uid()::text = "clientId");

CREATE TABLE IF NOT EXISTS public.agent_versions (
    id TEXT PRIMARY KEY,                   -- "<agentId>:v<version>"
    "clientId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    version INTEGER NOT NULL,              -- 1 = the instructions before the first learned change
    "systemPrompt" TEXT,
    "changeSummary" TEXT NOT NULL,         -- e.g. "Added: acknowledge worries about surgery before moving on"
    "suggestionId" TEXT,                   -- the suggestion it came from, if any
    "createdAt" BIGINT NOT NULL,
    UNIQUE ("agentId", version)
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_agent ON public.agent_versions ("agentId", version DESC);

ALTER TABLE public.agent_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own agent versions" ON public.agent_versions;
CREATE POLICY "Tenants can manage their own agent versions" ON public.agent_versions
    FOR ALL USING (auth.uid()::text = "clientId");
