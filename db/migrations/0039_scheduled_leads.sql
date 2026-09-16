-- 0039_scheduled_leads.sql — New Lead form submissions that go live later.
-- Does not create Patients/Referrals until go_live_at. Promote copies the
-- stored form through the same create path as Create Lead, stamped at go-live.

CREATE TABLE IF NOT EXISTS "scheduled_leads" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "owner_user_id" text NOT NULL,
  "display_name" text,
  "go_live_at" timestamptz NOT NULL,
  "form_data" jsonb,
  "force_stage" text,
  "status" text NOT NULL DEFAULT 'pending',
  "promoted_at" timestamptz,
  "promoted_referral_id" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_leads_id_uidx" ON "scheduled_leads" ("id");
CREATE INDEX IF NOT EXISTS "scheduled_leads_status_golive_idx"
  ON "scheduled_leads" ("status", "go_live_at");
CREATE INDEX IF NOT EXISTS "scheduled_leads_owner_idx"
  ON "scheduled_leads" ("owner_user_id", "go_live_at");
CREATE INDEX IF NOT EXISTS "scheduled_leads_updated_idx"
  ON "scheduled_leads" ("updated_at" DESC);

DROP TRIGGER IF EXISTS "trg_scheduled_leads_touch" ON "scheduled_leads";
CREATE TRIGGER "trg_scheduled_leads_touch"
  BEFORE UPDATE ON "scheduled_leads"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
