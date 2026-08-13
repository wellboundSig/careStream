-- 0031_files_archive.sql
-- Soft-archive for patient files. Archiving NEVER deletes — the file stays in
-- R2 and in this table, visible in a separate "Archived" section, and can be
-- restored. Used when e.g. Clinical sends a patient back to Intake because an
-- F2F document is no good and staff upload a replacement.

ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;

ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "archived_by_id" text;

ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "archived_reason" text;
