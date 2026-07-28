-- 0028_known_guardians.sql
-- Reusable known guardians (caregivers / contacts) linked to patients.
-- Flat patient contact columns remain as dual-write mirrors so EMR packets
-- and existing UI keep working; the system of record is these tables.

-- ── Directory of people ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "known_guardians" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "first_name" text,
  "last_name" text,
  "display_name" text,
  "phone" text,
  "email" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "known_guardians_id_uidx" ON "known_guardians" ("id");
CREATE INDEX IF NOT EXISTS "known_guardians_phone_idx" ON "known_guardians" ("phone");
CREATE INDEX IF NOT EXISTS "known_guardians_display_name_idx" ON "known_guardians" ("display_name");
CREATE INDEX IF NOT EXISTS "known_guardians_updated_at_idx" ON "known_guardians" ("updated_at");
DROP TRIGGER IF EXISTS "trg_known_guardians_touch" ON "known_guardians";
CREATE TRIGGER "trg_known_guardians_touch" BEFORE UPDATE ON "known_guardians" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Patient ↔ guardian links (relationship + which contact slots) ─────────────
CREATE TABLE IF NOT EXISTS "patient_guardians" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "patient_id" text,
  "guardian_id" text,
  "relationship" text,
  "is_primary" boolean DEFAULT false,
  "is_emergency" boolean DEFAULT false,
  "source" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "patient_guardians_id_uidx" ON "patient_guardians" ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "patient_guardians_patient_guardian_uidx"
  ON "patient_guardians" ("patient_id", "guardian_id");
CREATE INDEX IF NOT EXISTS "patient_guardians_patient_idx" ON "patient_guardians" ("patient_id");
CREATE INDEX IF NOT EXISTS "patient_guardians_guardian_idx" ON "patient_guardians" ("guardian_id");
CREATE INDEX IF NOT EXISTS "patient_guardians_updated_at_idx" ON "patient_guardians" ("updated_at");
DROP TRIGGER IF EXISTS "trg_patient_guardians_touch" ON "patient_guardians";
CREATE TRIGGER "trg_patient_guardians_touch" BEFORE UPDATE ON "patient_guardians" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Dual-write mirrors on patients (Primary Contact is new; emergency gains relationship)
ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "primary_contact_name" text;
ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "primary_contact_phone" text;
ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "primary_contact_email" text;
ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "primary_contact_relationship" text;
ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "emergency_contact_relationship" text;

COMMENT ON TABLE "known_guardians" IS 'Reusable caregiver/contact people; one guardian may link to many patients.';
COMMENT ON TABLE "patient_guardians" IS 'Patient↔guardian edge: relationship + primary/emergency slot flags.';
COMMENT ON COLUMN "patients"."primary_contact_name" IS 'Dual-write mirror of primary patient_guardians link display name.';
COMMENT ON COLUMN "patients"."emergency_contact_relationship" IS 'Dual-write mirror of emergency patient_guardians.relationship.';
