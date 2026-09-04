-- 0033_opwdd_revamp.sql — OPWDD flow revamp (2026-08-26).
--
-- 1. homehealth_opwdd_entities — predefined list of OPWDD packet submission
--    partners (CCOs / Service Access Agencies / LGUs across NYC, LI,
--    Westchester). Drives the searchable "submitted to" dropdown in the
--    revamped OPWDD workspace. Seeded from
--    scripts/data/opwdd_packet_submission_partners.csv.
--
-- 2. New columns on opwdd_eligibility_cases for the 5-step flow:
--    Phase 1 (concurrent): packet assembly · visit scheduling · visit completion
--    Phase 2: submit to health home · parent letter + case completion.
--    All additive — old UI ignores them.

CREATE TABLE IF NOT EXISTS "homehealth_opwdd_entities" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "name" text NOT NULL,
  "tier" text,
  "category" text,
  "submission_status" text,
  "direct_authority_basis" text,
  "population" text,
  "counties" text[],
  "phone" text,
  "email" text,
  "address" text,
  "next_step" text,
  "source_url" text,
  "verification_notes" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamptz,
  "updated_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "homehealth_opwdd_entities_id_uidx" ON "homehealth_opwdd_entities" ("id");
CREATE INDEX IF NOT EXISTS "homehealth_opwdd_entities_name_idx" ON "homehealth_opwdd_entities" ("name");

DROP TRIGGER IF EXISTS "trg_homehealth_opwdd_entities_touch" ON "homehealth_opwdd_entities";
CREATE TRIGGER "trg_homehealth_opwdd_entities_touch"
  BEFORE UPDATE ON "homehealth_opwdd_entities"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Revamped flow stamps on the case row.
ALTER TABLE "opwdd_eligibility_cases" ADD COLUMN IF NOT EXISTS "packet_assembled_at" timestamptz;
ALTER TABLE "opwdd_eligibility_cases" ADD COLUMN IF NOT EXISTS "packet_assembled_by_id" text;
ALTER TABLE "opwdd_eligibility_cases" ADD COLUMN IF NOT EXISTS "psychological_visit_completed_at" timestamptz;
ALTER TABLE "opwdd_eligibility_cases" ADD COLUMN IF NOT EXISTS "psychosocial_visit_completed_at" timestamptz;
ALTER TABLE "opwdd_eligibility_cases" ADD COLUMN IF NOT EXISTS "submitted_to_entity_id" text;
ALTER TABLE "opwdd_eligibility_cases" ADD COLUMN IF NOT EXISTS "submitted_to_entity_name" text;
ALTER TABLE "opwdd_eligibility_cases" ADD COLUMN IF NOT EXISTS "parent_letter_file_id" text;
ALTER TABLE "opwdd_eligibility_cases" ADD COLUMN IF NOT EXISTS "parent_letter_received_at" timestamptz;
