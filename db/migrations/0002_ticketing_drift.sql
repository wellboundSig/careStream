-- 0002_ticketing_drift.sql — additive drift found during cutover (2026-07-05).
-- The live Airtable base gained the Clinicians table (field-support roster) and
-- four IT-ticketing columns after the schema snapshot was taken. 0001 has been
-- regenerated for fresh installs; this migration patches existing databases.

CREATE TABLE IF NOT EXISTS "clinicians" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "esper_id" text,
  "first_name" text,
  "last_name" text,
  "name" text,
  "discipline" text,
  "worker_id" text,
  "device_serial" text,
  "device_name" text,
  "email" text,
  "last_seen_at" timestamptz,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_clinicians_id" ON "clinicians" ("id");
CREATE INDEX IF NOT EXISTS "idx_clinicians_esper_id" ON "clinicians" ("esper_id");
CREATE INDEX IF NOT EXISTS "idx_clinicians_worker_id" ON "clinicians" ("worker_id");
CREATE INDEX IF NOT EXISTS "idx_clinicians_updated_at" ON "clinicians" ("updated_at");
DROP TRIGGER IF EXISTS "trg_clinicians_touch" ON "clinicians";
CREATE TRIGGER "trg_clinicians_touch" BEFORE UPDATE ON "clinicians" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "source" text;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "wifi_connected" boolean;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "facility_id" text;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "clinician_id" text;
CREATE INDEX IF NOT EXISTS "idx_tickets_facility_id" ON "tickets" ("facility_id");
CREATE INDEX IF NOT EXISTS "idx_tickets_clinician_id" ON "tickets" ("clinician_id");

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "field_topic" boolean;
