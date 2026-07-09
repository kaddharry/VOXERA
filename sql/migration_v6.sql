-- VOXERA: Sprint 5 - Business Operating Hours

ALTER TABLE public.business_settings
ADD COLUMN IF NOT EXISTS opening_time TEXT;

ALTER TABLE public.business_settings
ADD COLUMN IF NOT EXISTS closing_time TEXT;