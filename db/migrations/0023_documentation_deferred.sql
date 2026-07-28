-- 0023_documentation_deferred.sql
-- Fast-track to scheduling without F2F + clinical. Both are completed after SOC.
-- A 30-day paperwork clock starts when SOC is scheduled.

ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "documentation_deferred" boolean;
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "documentation_deferred_at" timestamptz;
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "documentation_deferred_by_id" text;
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "documentation_due_date" text;
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "documentation_cleared_at" timestamptz;
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "documentation_cleared_by_id" text;

CREATE INDEX IF NOT EXISTS "idx_referrals_documentation_deferred"
  ON "referrals" ("documentation_deferred")
  WHERE "documentation_deferred" IS TRUE;
