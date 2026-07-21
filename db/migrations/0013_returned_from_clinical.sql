-- 0013_returned_from_clinical.sql
-- Clinical RN "Send Back to Intake" flag + note (mirrors eligibility_returned_to_intake_*).
-- These fields were already written by the UI but never added to Aurora / registry,
-- so the API rejected the PATCH and the stage change rolled back.

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "returned_from_clinical" boolean DEFAULT false;

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "returned_from_clinical_note" text;

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "returned_from_clinical_at" timestamptz;

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "returned_from_clinical_by" text;

COMMENT ON COLUMN "referrals"."returned_from_clinical" IS 'True when Clinical RN sent the referral back to Intake for more paperwork.';
COMMENT ON COLUMN "referrals"."returned_from_clinical_note" IS 'Optional note from Clinical RN explaining what Intake needs to gather.';

CREATE INDEX IF NOT EXISTS "idx_referrals_returned_from_clinical"
  ON "referrals" ("returned_from_clinical")
  WHERE "returned_from_clinical" = true;
