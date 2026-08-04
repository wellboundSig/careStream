-- 0029_episode_type.sql
-- Referral episode: SOC (Start of Care) or ROC (Resumption of Care).
-- Default SOC for all existing rows. Pipeline stages stay unchanged.

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "episode_type" text DEFAULT 'SOC';

UPDATE "referrals"
SET "episode_type" = 'SOC'
WHERE "episode_type" IS NULL OR TRIM("episode_type") = '';

COMMENT ON COLUMN "referrals"."episode_type" IS 'SOC = Start of Care; ROC = Resumption of Care';
