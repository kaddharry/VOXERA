-- Migration v20: Public "Book a Demo" lead capture (spec §5).
--
-- Required ordering per spec §5.3: prospect submits details FIRST (no
-- account needed yet) -> signs up/in -> the request links to that account
-- -> confirm phone/consent -> demo call. demo_requests exists specifically
-- to survive that gap between "submitted" and "has an account" — it's
-- deliberately NOT scoped by clientId/auth.uid() the way every other table
-- here is, since it's written by an anonymous visitor before any auth
-- context exists. RLS still applies once linked: a signed-in user may only
-- read/update their OWN linked request.

CREATE TABLE IF NOT EXISTS public.demo_requests (
    id TEXT PRIMARY KEY,
    "hospitalName" TEXT NOT NULL,
    "institutionType" TEXT,
    department TEXT,
    "contactName" TEXT NOT NULL,
    "workEmail" TEXT NOT NULL,
    phone TEXT NOT NULL,
    "preferredLanguage" TEXT,
    workflow TEXT,
    description TEXT,
    consent BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'awaiting_account'
        CHECK (status IN ('awaiting_account', 'ready', 'calling', 'completed', 'failed', 'cancelled')),
    "linkedUserId" UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    "callSid" TEXT,
    "createdAt" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
    "linkedAt" BIGINT
);

CREATE INDEX IF NOT EXISTS idx_demo_requests_linked_user ON public.demo_requests ("linkedUserId");

ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

-- Public insert (the whole point — no auth exists yet at submission time).
-- No public SELECT/UPDATE policy: reads/writes after creation go through
-- the service-role client (app/api/demo-requests/*), which validates
-- ownership in application code before returning or mutating a row, same
-- as the public /api/telephony/outbound route's own unauthenticated-by-
-- design, app-level-validated pattern.
DROP POLICY IF EXISTS "Anyone can submit a demo request" ON public.demo_requests;
CREATE POLICY "Anyone can submit a demo request" ON public.demo_requests
    FOR INSERT WITH CHECK (true);

-- Once linked, the owning user can read (not blindly write — status
-- transitions are server-controlled) their own request.
DROP POLICY IF EXISTS "Users can read their own linked demo request" ON public.demo_requests;
CREATE POLICY "Users can read their own linked demo request" ON public.demo_requests
    FOR SELECT USING (auth.uid() = "linkedUserId");
