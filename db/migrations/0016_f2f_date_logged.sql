-- 0016_f2f_date_logged.sql — Who logged the F2F date of visit, and when.

ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "f2f_date_logged_by_id" text;
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "f2f_date_logged_at" timestamptz;
