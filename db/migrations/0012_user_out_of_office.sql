-- 0012_user_out_of_office.sql
-- Self-serve Out of Office on users. Does not replace account status
-- (Active/Pending/Suspended/Revoked) — OOO users stay assignable with a warning.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "ooo_active" boolean DEFAULT false;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "ooo_starts_on" date;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "ooo_ends_on" date;

COMMENT ON COLUMN "users"."ooo_active" IS 'User opted into Out of Office (may be scheduled via ooo_starts_on).';
COMMENT ON COLUMN "users"."ooo_starts_on" IS 'Inclusive start date; null means effective immediately when ooo_active.';
COMMENT ON COLUMN "users"."ooo_ends_on" IS 'Inclusive end date; null means open-ended until manually turned off.';

CREATE INDEX IF NOT EXISTS "idx_users_ooo_active"
  ON "users" ("ooo_active")
  WHERE "ooo_active" = true;
