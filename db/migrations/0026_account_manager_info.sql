-- 0026_account_manager_info.sql
-- Multi-entry Account manager info log on referrals (from nurse @mentions in notes).

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "account_manager_info" text;
