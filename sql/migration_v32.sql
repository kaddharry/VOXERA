-- Persist Twilio Media Stream lifecycle diagnostics on the associated call.
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS "streamSid" text;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS "streamStatus" text;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS "streamError" text;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS "streamStatusAt" bigint;
