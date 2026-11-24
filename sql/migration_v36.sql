-- Migration v36: call learnings — what the agents learn from each call.
--
-- After every call the system extracts durable, grounded takeaways and stores
-- them here in three scopes:
--   * patient: facts/preferences/open items about ONE patient. Shared by every
--     agent that calls them, so the next call (any agent) starts informed.
--   * agent:   lessons about how ONE agent should handle calls better.
--   * global:  lessons that held across several agents (or are clearly generic);
--     applied to every agent in the account. Never contains patient details.
-- Patient facts are active immediately; agent/global lessons start 'pending' and
-- become 'active' once at least two different calls support them.

CREATE TABLE IF NOT EXISTS public.call_learnings (
    id TEXT PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('patient', 'agent', 'global')),
    "agentId" TEXT,                         -- scope = 'agent'
    "patientId" TEXT,                       -- scope = 'patient'
    category TEXT NOT NULL,
    key TEXT,                               -- patient facts: stable slug, e.g. "preferred_call_time"
    text TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '[]',   -- verbatim quotes from the transcript
    "sourceCallIds" JSONB NOT NULL DEFAULT '[]',
    "supportCount" INTEGER NOT NULL DEFAULT 1,
    confidence REAL NOT NULL DEFAULT 0.7,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'retired')),
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_call_learnings_patient ON public.call_learnings ("clientId", "patientId") WHERE scope = 'patient';
CREATE INDEX IF NOT EXISTS idx_call_learnings_agent ON public.call_learnings ("clientId", "agentId") WHERE scope = 'agent';
CREATE INDEX IF NOT EXISTS idx_call_learnings_global ON public.call_learnings ("clientId") WHERE scope = 'global';

ALTER TABLE public.call_learnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own call learnings" ON public.call_learnings;
CREATE POLICY "Tenants can manage their own call learnings" ON public.call_learnings
    FOR ALL USING (auth.uid()::text = "clientId");
