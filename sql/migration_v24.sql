-- Migration v24: record who answered a call (Twilio Answering Machine
-- Detection).
--
-- Scheduled follow-up calls are placed with Twilio's asynchronous AMD
-- (lib/telephony/outbound.ts). Twilio reports the verdict separately from
-- the call's end, to /api/telephony/amd, which stores it here; the status
-- callback then reads it, so a call answered by voicemail is retried
-- instead of being treated as a conversation (lib/scheduler/policy.ts).
--
-- Values are Twilio's AnsweredBy: human, machine_start, fax, unknown.
-- Nullable and additive: calls without AMD (manual calls, campaigns, rows
-- from before this migration) leave it NULL, and the app works without
-- this column (it just can't use the AMD verdict until it exists).

ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS "answeredBy" TEXT;
