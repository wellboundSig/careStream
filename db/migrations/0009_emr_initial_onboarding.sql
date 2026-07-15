-- 0009_emr_initial_onboarding.sql
-- ALF Intake companion milestone: early HCHB chart creation.
-- Distinct from emr_onboarded_at (full EMR Onboarding → Staffing gate).

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "emr_initial_onboarded_at" text;

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "emr_initial_onboarded_by_id" text;

CREATE INDEX IF NOT EXISTS "idx_referrals_emr_initial_onboarded_at"
  ON "referrals" ("emr_initial_onboarded_at");
