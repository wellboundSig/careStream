-- 0008_coc_nurse_facilities.sql
-- COC nurses are regular Users. This join table assigns them to NetworkFacilities
-- (many-to-many). Lead Entry uses these links to auto-assign / pick a COC nurse
-- when an ALF facility is chosen. Referrals.coc_nurse_id stores the selection.

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "coc_nurse_id" text;

CREATE INDEX IF NOT EXISTS "idx_referrals_coc_nurse_id" ON "referrals" ("coc_nurse_id");

CREATE TABLE IF NOT EXISTS "coc_nurse_facilities" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "user_id" text,
  "facility_id" text,
  "created_at" timestamptz,
  "updated_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "coc_nurse_facilities_id_uidx" ON "coc_nurse_facilities" ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "coc_nurse_facilities_user_fac_uidx"
  ON "coc_nurse_facilities" ("user_id", "facility_id");
CREATE INDEX IF NOT EXISTS "idx_coc_nurse_facilities_user_id" ON "coc_nurse_facilities" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_coc_nurse_facilities_facility_id" ON "coc_nurse_facilities" ("facility_id");
CREATE INDEX IF NOT EXISTS "idx_coc_nurse_facilities_updated_at" ON "coc_nurse_facilities" ("updated_at");

DROP TRIGGER IF EXISTS "trg_coc_nurse_facilities_touch" ON "coc_nurse_facilities";
CREATE TRIGGER "trg_coc_nurse_facilities_touch"
  BEFORE UPDATE ON "coc_nurse_facilities"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
