-- 0025_urgent_care_type.sql
-- Urgent care subtype: wound | insulin | both (nullable / blank until set).

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "urgent_care_type" text;
