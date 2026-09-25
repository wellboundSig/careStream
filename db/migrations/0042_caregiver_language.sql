-- 0042_caregiver_language.sql — caregiver preferred language on SPN triage.
--
-- caregiver_language_differs: 'Yes' / 'No' tri-state text (matches the other
--   triage yes/no fields). Checked means the caregiver's preferred language
--   differs from the patient receiving care.
-- caregiver_preferred_language: language code (same codes as
--   patients.preferred_language, from the languages catalog).

ALTER TABLE "triage_adult" ADD COLUMN IF NOT EXISTS "caregiver_language_differs" text;
ALTER TABLE "triage_adult" ADD COLUMN IF NOT EXISTS "caregiver_preferred_language" text;

ALTER TABLE "triage_pediatric" ADD COLUMN IF NOT EXISTS "caregiver_language_differs" text;
ALTER TABLE "triage_pediatric" ADD COLUMN IF NOT EXISTS "caregiver_preferred_language" text;
