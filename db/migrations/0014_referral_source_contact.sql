-- 0014_referral_source_contact.sql
-- Optional contact channels on referral sources (people). Spreadsheet imports
-- often include phone/email alongside the person + organization.

ALTER TABLE "referral_sources"
  ADD COLUMN IF NOT EXISTS "phone" text;

ALTER TABLE "referral_sources"
  ADD COLUMN IF NOT EXISTS "email" text;

COMMENT ON COLUMN "referral_sources"."phone" IS 'Optional phone for the referring contact person.';
COMMENT ON COLUMN "referral_sources"."email" IS 'Optional email for the referring contact person.';
