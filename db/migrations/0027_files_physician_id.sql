-- 0027_files_physician_id.sql
-- Optional source provider on a file (independent of the patient's PCP).
-- Many files → one physician; one file → at most one physician.

ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "physician_id" text;

CREATE INDEX IF NOT EXISTS "idx_files_physician_id" ON "files" ("physician_id");
