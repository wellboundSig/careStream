-- 0020_clinical_review_started.sql
-- Who started the Clinical RN checklist (first save), and who pushed from Intake.

ALTER TABLE "clinical_review" ADD COLUMN IF NOT EXISTS "started_by" text;
ALTER TABLE "clinical_review" ADD COLUMN IF NOT EXISTS "started_at" timestamptz;

ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "clinical_review_pushed_by_id" text;

CREATE INDEX IF NOT EXISTS "clinical_review_started_by_idx"
  ON "clinical_review" ("started_by");
