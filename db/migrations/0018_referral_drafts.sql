-- 0018_referral_drafts.sql — In-progress New Lead form drafts.
-- Owned by one user (owner_user_id). Never creates Patients/Referrals until
-- the form is submitted. Discard hard-deletes the row.

CREATE TABLE IF NOT EXISTS "referral_drafts" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "owner_user_id" text NOT NULL,
  "display_name" text,
  "draft_number" bigint,
  "form_data" jsonb,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "referral_drafts_id_uidx" ON "referral_drafts" ("id");
CREATE INDEX IF NOT EXISTS "referral_drafts_owner_idx"
  ON "referral_drafts" ("owner_user_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "referral_drafts_updated_idx"
  ON "referral_drafts" ("updated_at" DESC);

DROP TRIGGER IF EXISTS "trg_referral_drafts_touch" ON "referral_drafts";
CREATE TRIGGER "trg_referral_drafts_touch"
  BEFORE UPDATE ON "referral_drafts"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
