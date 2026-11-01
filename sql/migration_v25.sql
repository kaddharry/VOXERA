-- Migration v25: post-call findings for the self-learning pipeline.
--
-- After each call, lib/insights/analyze-call.ts records
--   * knowledge gaps: questions the agent couldn't answer, and
--   * emotional failure points: moments the patient's mood got worse right
--     after an agent reply that missed or mishandled what they said.
-- One row per finding, collected across calls so repeated problems can be
-- grouped (by topic, by agent) and turned into suggestions for the hospital.
-- Each call's findings are also kept on its own call_logs.summary for the
-- Calls & Insights page, so that page works before this migration runs.
--
-- Also records which agent handled a call (call_logs."agentId"), set when
-- the phone stream starts (lib/telephony/stream-handler.ts). Nullable and
-- additive: older calls leave it NULL.

ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS "agentId" TEXT;
CREATE INDEX IF NOT EXISTS idx_call_logs_agent ON public.call_logs ("agentId");

CREATE TABLE IF NOT EXISTS public.call_insights (
    id TEXT PRIMARY KEY,                   -- "<sessionId>:gap:<turn>" / "<sessionId>:failure:<turn>"
    "clientId" TEXT NOT NULL,
    "callSid" TEXT,
    "sessionId" TEXT NOT NULL,
    "patientId" TEXT,
    "agentId" TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('knowledge_gap', 'emotional_failure')),
    turn INTEGER NOT NULL,                 -- patient turn number within the call (1 = first)
    topic TEXT,                            -- knowledge gaps: short topic for grouping across calls
    "patientText" TEXT,                    -- the question / what the patient said before the reply
    "agentText" TEXT,                      -- the agent reply involved
    details JSONB NOT NULL DEFAULT '{}',   -- failure points: patientAfter, before/after emotion, whatWentWrong
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'addressed')),
    "createdAt" BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_call_insights_client ON public.call_insights ("clientId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_call_insights_session ON public.call_insights ("sessionId");
CREATE INDEX IF NOT EXISTS idx_call_insights_topic ON public.call_insights ("clientId", kind, topic);

ALTER TABLE public.call_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own call insights" ON public.call_insights;
CREATE POLICY "Tenants can manage their own call insights" ON public.call_insights
    FOR ALL USING (auth.uid()::text = "clientId");
