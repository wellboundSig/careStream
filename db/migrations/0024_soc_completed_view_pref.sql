-- 0024_soc_completed_view_pref.sql
-- Persist SOC Completed queue view preference (standard | pending_log).

ALTER TABLE "user_preferences"
  ADD COLUMN IF NOT EXISTS "soc_completed_view" text;
