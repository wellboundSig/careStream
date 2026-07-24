-- 0021_referral_method.sql
-- Separate *how* a lead reached us (method) from *who* referred (source).
-- Optional default method on directory sources; stamped on each referral at intake.
-- Ensures locked-in Unknown source for when the referring person is unknown.

ALTER TABLE "referral_sources"
  ADD COLUMN IF NOT EXISTS "method" text;

ALTER TABLE "referral_sources"
  ADD COLUMN IF NOT EXISTS "is_system" text;

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "referral_method" text;

COMMENT ON COLUMN "referral_sources"."method" IS
  'Optional default referral method for this source (e.g. Word of Mouth). Autofills lead forms; leave blank when unknown.';

COMMENT ON COLUMN "referral_sources"."is_system" IS
  'TRUE for locked system rows (e.g. Unknown). Name/type must not be edited or deleted.';

COMMENT ON COLUMN "referrals"."referral_method" IS
  'How this referral reached us (Word of Mouth, Facebook Ads, etc.). Independent of referral_source_id.';

-- Locked Unknown source for leads with no known referring person.
INSERT INTO "referral_sources" (
  "rec_id", "id", "name", "type", "is_active", "is_system",
  "source_entity", "created_at", "updated_at"
)
SELECT
  'rec_src_unknown',
  'src_unknown',
  'Unknown',
  'Other',
  'TRUE',
  'TRUE',
  NULL,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "referral_sources" WHERE "id" = 'src_unknown'
);

UPDATE "referral_sources"
SET
  "name" = 'Unknown',
  "type" = COALESCE(NULLIF(TRIM("type"), ''), 'Other'),
  "is_active" = 'TRUE',
  "is_system" = 'TRUE',
  "updated_at" = NOW()
WHERE "id" = 'src_unknown';
