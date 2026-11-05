-- Migration v27: per-agent speech provider + language (Deepgram vs Gnani/
-- Vachana for Indian-language calls), with a tenant-level default.
--
-- speech_provider/language on `agents` are NULL by default — NULL means
-- "inherit the tenant's business_settings default", not "Deepgram". Resolved
-- in lib/speech/resolve.ts (agent row wins when set, business_settings is
-- the fallback).
--
-- business_settings.language already exists (added pre-v27, DEFAULT
-- 'English', never read or written anywhere in the app) — repurposed here as
-- the tenant-level default language code going forward instead of adding a
-- new column. Its old free-text 'English' default is treated as equivalent
-- to 'en-IN' the first time it's read (see lib/speech/resolve.ts), not
-- matched literally.

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS speech_provider TEXT;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS language TEXT;

ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS speech_provider TEXT DEFAULT 'deepgram';
