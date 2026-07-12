-- SQL Migration: Add custom voice personalization and customer recovery settings to business_settings

ALTER TABLE public.business_settings
ADD COLUMN IF NOT EXISTS voice_provider text,
ADD COLUMN IF NOT EXISTS custom_voice_id text,
ADD COLUMN IF NOT EXISTS sms_recovery_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS sms_recovery_template text DEFAULT 'Hi, we noticed you had a less than stellar experience today. Please let us make it up to you: {{link}}',
ADD COLUMN IF NOT EXISTS sms_recovery_link text DEFAULT '';
