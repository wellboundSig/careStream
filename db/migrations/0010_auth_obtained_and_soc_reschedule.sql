-- 0010_auth_obtained_and_soc_reschedule.sql
-- Auth: track who requested pending auth + referral-level "auth obtained" stamp.
-- Pre-SOC: durable log of SOC reschedules for reporting.

-- ── Authorizations: who last requested this auth ─────────────────────────────
ALTER TABLE "authorizations"
  ADD COLUMN IF NOT EXISTS "requested_by_user_id" text;

CREATE INDEX IF NOT EXISTS "idx_authorizations_requested_by_user_id"
  ON "authorizations" ("requested_by_user_id");

-- ── Referrals: auth obtained milestone (surfaces on Intake / Clinical / Staffing rows)
ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "auth_obtained_at" text;

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "auth_obtained_by_id" text;

CREATE INDEX IF NOT EXISTS "idx_referrals_auth_obtained_at"
  ON "referrals" ("auth_obtained_at");

-- ── SOC reschedule audit log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "soc_reschedule_log" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "referral_id" text,
  "patient_id" text,
  "previous_soc_date" text,
  "new_soc_date" text,
  "reason_category" text,
  "reason_detail" text,
  "rescheduled_by_id" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "soc_reschedule_log_id_uidx"
  ON "soc_reschedule_log" ("id");

CREATE INDEX IF NOT EXISTS "idx_soc_reschedule_log_referral_id"
  ON "soc_reschedule_log" ("referral_id");

CREATE INDEX IF NOT EXISTS "idx_soc_reschedule_log_patient_id"
  ON "soc_reschedule_log" ("patient_id");

CREATE INDEX IF NOT EXISTS "idx_soc_reschedule_log_created_at"
  ON "soc_reschedule_log" ("created_at");

DROP TRIGGER IF EXISTS "trg_soc_reschedule_log_touch" ON "soc_reschedule_log";
CREATE TRIGGER "trg_soc_reschedule_log_touch"
  BEFORE UPDATE ON "soc_reschedule_log"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
