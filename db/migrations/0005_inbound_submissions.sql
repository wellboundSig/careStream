-- 0005_inbound_submissions.sql — Inbound Submissions (email → ticket queue).
-- Emails to referral@wellboundcarestream.com become tracked submissions that
-- staff convert into Lead Entry or Intake referrals.

CREATE TABLE IF NOT EXISTS "inbound_submissions" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "submission_number" bigint,
  "from_email" text,
  "from_name" text,
  "to_addrs" text,
  "cc_addrs" text,
  "subject" text,
  "body_text" text,
  "body_html" text,
  "message_id" text,
  "in_reply_to" text,
  "received_at" timestamptz,
  "provider" text,
  "provider_email_id" text,
  "raw_headers" jsonb,
  "status" text,
  "opened_by_id" text,
  "opened_at" timestamptz,
  "assigned_to_id" text,
  "parsed" jsonb,
  "convert_mode" text,
  "converted_patient_id" text,
  "converted_referral_id" text,
  "converted_by_id" text,
  "converted_at" timestamptz,
  "discard_reason" text,
  "discard_explanation" text,
  "discarded_by_id" text,
  "discarded_at" timestamptz,
  "source" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_inbound_submissions_id" ON "inbound_submissions" ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_inbound_submissions_message_id" ON "inbound_submissions" ("message_id") WHERE "message_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_inbound_submissions_provider_email_id" ON "inbound_submissions" ("provider_email_id");
CREATE INDEX IF NOT EXISTS "idx_inbound_submissions_status" ON "inbound_submissions" ("status");
CREATE INDEX IF NOT EXISTS "idx_inbound_submissions_received_at" ON "inbound_submissions" ("received_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_inbound_submissions_assigned_to_id" ON "inbound_submissions" ("assigned_to_id");
CREATE INDEX IF NOT EXISTS "idx_inbound_submissions_converted_referral_id" ON "inbound_submissions" ("converted_referral_id");
CREATE INDEX IF NOT EXISTS "idx_inbound_submissions_updated_at" ON "inbound_submissions" ("updated_at");
DROP TRIGGER IF EXISTS "trg_inbound_submissions_touch" ON "inbound_submissions";
CREATE TRIGGER "trg_inbound_submissions_touch" BEFORE UPDATE ON "inbound_submissions" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS "inbound_submission_attachments" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "inbound_submission_id" text,
  "file_name" text,
  "content_type" text,
  "size_bytes" bigint,
  "storage_key" text,
  "provider_attachment_id" text,
  "uploaded_at" timestamptz,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_inbound_submission_attachments_id" ON "inbound_submission_attachments" ("id");
CREATE INDEX IF NOT EXISTS "idx_inbound_submission_attachments_submission" ON "inbound_submission_attachments" ("inbound_submission_id");
CREATE INDEX IF NOT EXISTS "idx_inbound_submission_attachments_updated_at" ON "inbound_submission_attachments" ("updated_at");
DROP TRIGGER IF EXISTS "trg_inbound_submission_attachments_touch" ON "inbound_submission_attachments";
CREATE TRIGGER "trg_inbound_submission_attachments_touch" BEFORE UPDATE ON "inbound_submission_attachments" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS "inbound_submission_events" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "inbound_submission_id" text,
  "actor_id" text,
  "action" text,
  "detail" text,
  "metadata" jsonb,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_inbound_submission_events_id" ON "inbound_submission_events" ("id");
CREATE INDEX IF NOT EXISTS "idx_inbound_submission_events_submission" ON "inbound_submission_events" ("inbound_submission_id");
CREATE INDEX IF NOT EXISTS "idx_inbound_submission_events_created_at" ON "inbound_submission_events" ("created_at");
DROP TRIGGER IF EXISTS "trg_inbound_submission_events_touch" ON "inbound_submission_events";
CREATE TRIGGER "trg_inbound_submission_events_touch" BEFORE UPDATE ON "inbound_submission_events" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
