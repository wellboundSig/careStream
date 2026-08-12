-- 0030_clinical_review_assigned.sql
-- Post-SOC clinical handoff: marketer assigns a Clinical Intake RN.
-- Case stays on SOC Completed via soc_completed_date; appears in Clinical
-- via in_clinical_review + these assignee stamps.

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "clinical_review_assigned_to_id" text;

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "clinical_review_assigned_at" timestamptz;

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "clinical_review_assigned_by_id" text;

COMMENT ON COLUMN "referrals"."clinical_review_assigned_to_id" IS 'Clinical RN assigned for post-SOC / concurrent clinical review';
COMMENT ON COLUMN "referrals"."clinical_review_assigned_at" IS 'When clinical review was assigned';
COMMENT ON COLUMN "referrals"."clinical_review_assigned_by_id" IS 'User who assigned the Clinical RN';
