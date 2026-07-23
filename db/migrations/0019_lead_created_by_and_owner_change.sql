-- 0019_lead_created_by_and_owner_change.sql
-- Immutable initial Lead Entry submitter + audit stamps for intake-owner changes.

-- Who submitted the original lead. Set once on create; never overwritten.
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "lead_created_by_id" text;

-- Last (re)assignment of intake_owner_id — used for timeline + team activity.
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "intake_owner_changed_at" timestamptz;
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "intake_owner_changed_by_id" text;

CREATE INDEX IF NOT EXISTS "referrals_lead_created_by_idx"
  ON "referrals" ("lead_created_by_id");
CREATE INDEX IF NOT EXISTS "referrals_intake_owner_changed_idx"
  ON "referrals" ("intake_owner_changed_at" DESC);
