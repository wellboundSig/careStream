-- 0035_clinical_lead_precheck.sql
-- Clinical Lead Pre-Check: first glance by Clinical on a new lead.
-- current_stage holds the queue; these stamps record who signed off and when.

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "clinical_lead_precheck_approved_at" timestamptz;

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "clinical_lead_precheck_approved_by_id" text;

COMMENT ON COLUMN "referrals"."clinical_lead_precheck_approved_at" IS 'When Clinical marked the lead viable (left Clinical Lead Pre-Check)';
COMMENT ON COLUMN "referrals"."clinical_lead_precheck_approved_by_id" IS 'User who marked the lead viable';
