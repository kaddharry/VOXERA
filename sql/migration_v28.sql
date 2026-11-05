-- Migration v28: patient condition + risk level (Patients page redesign).
--
-- Note: v27 is taken by feat/gnani-speech-system (PR #110, not yet merged
-- to main) — this is numbered v28 to avoid a filename/number collision
-- with that in-flight branch. Purely additive (ADD COLUMN IF NOT EXISTS),
-- so it's independent of and safe to run before or after v27 lands.
--
-- Patients previously had no structured clinical signal — just a freeform
-- `notes` field and uploaded documents. `condition` is a free-text label
-- (e.g. "Post-Op Recovery", "Type 2 Diabetes") so staff can tag patients
-- without a fixed taxonomy; `riskLevel` is a fixed 4-tier scale that drives
-- the color-coded badges across the Patients list/detail pages.

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS "condition" TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS "riskLevel" TEXT NOT NULL DEFAULT 'low'
    CHECK ("riskLevel" IN ('low', 'medium', 'high', 'critical'));

CREATE INDEX IF NOT EXISTS idx_patients_risk_level ON public.patients ("clientId", "riskLevel");
