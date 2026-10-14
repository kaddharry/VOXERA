-- Migration v17: Patient documents (multiple records per patient).
--
-- patients.notes (migration_v14.sql) only ever held one collapsed blob of
-- text — the patient-add form concatenated any uploaded file's extracted
-- text into that single column at creation time, with no way to add a
-- second document later without overwriting the first (spec's "Multiple
-- records per patient" requirement explicitly calls this out: "do not
-- overwrite the last uploaded document as a shortcut"). This adds a proper
-- document list; patients.notes becomes the manually-typed free-text field
-- only, and uploaded files become patient_documents rows instead.

CREATE TABLE IF NOT EXISTS public.patient_documents (
    id TEXT PRIMARY KEY,
    "patientId" TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    "clientId" TEXT NOT NULL,
    filename TEXT NOT NULL,
    "mimeType" TEXT,
    "extractedText" TEXT NOT NULL,
    "createdAt" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);

CREATE INDEX IF NOT EXISTS idx_patient_documents_patient ON public.patient_documents ("patientId");
CREATE INDEX IF NOT EXISTS idx_patient_documents_client ON public.patient_documents ("clientId");

ALTER TABLE public.patient_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenants can manage their own patient documents" ON public.patient_documents;
CREATE POLICY "Tenants can manage their own patient documents" ON public.patient_documents
    FOR ALL USING (auth.uid()::text = "clientId");

-- Backfill: every existing patient's single notes blob (which previously
-- mixed any uploaded file's extracted text together with manually-typed
-- notes, indistinguishably) becomes its first document, so nothing already
-- relied on at call time loses context. notes is then cleared — not left
-- duplicated alongside the new document row, which would otherwise inject
-- the same text twice into every future call's PATIENT CONTEXT block. The
-- content itself isn't lost, only relocated to the new canonical place.
INSERT INTO public.patient_documents (id, "patientId", "clientId", filename, "extractedText", "createdAt")
SELECT 'bf_' || id, id, "clientId", 'Imported from original notes field', notes, "createdAt"
FROM public.patients
WHERE notes IS NOT NULL AND trim(notes) <> ''
ON CONFLICT (id) DO NOTHING;

UPDATE public.patients SET notes = '' WHERE notes IS NOT NULL AND trim(notes) <> '';
