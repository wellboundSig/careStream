-- 0040_marketer_attribution.sql — original-marketer attribution + NTUC outcome date.
--
-- original_marketer_id: the marketer assigned when the referral was created.
--   Write-once — reassignment (changeMarketer) only touches marketer_id, so
--   incentive credit stays with the originally assigned marketer forever.
--   Backfilled for existing rows from activity_log 'marketer_changed' entries
--   (earliest previousMarketerId), else copied from current marketer_id.
--
-- ntuc_date: when the referral actually entered NTUC (outcome date), so NTUC
--   is credited to the period it was resolved in — same as soc_completed_date
--   for SOC. Cleared if a referral is re-opened out of NTUC; restamped if it
--   NTUCs again. Backfilled from stage_history (to_stage = 'NTUC').

ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "original_marketer_id" text;
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "ntuc_date" timestamptz;

CREATE INDEX IF NOT EXISTS "idx_referrals_original_marketer_id" ON "referrals" ("original_marketer_id");
CREATE INDEX IF NOT EXISTS "idx_referrals_ntuc_date" ON "referrals" ("ntuc_date");
