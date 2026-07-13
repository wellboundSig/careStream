-- 0007_issue_reports.sql — Staff bug reports & enhancement suggestions.
-- One user → many reports; each report has exactly one reporter (user_id).

CREATE TABLE IF NOT EXISTS "issue_reports" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "user_id" text,
  "report_type" text,
  "description" text,
  "screenshot_r2_key" text,
  "screenshot_file_name" text,
  "screenshot_content_type" text,
  "status" text,
  "created_at" timestamptz,
  "updated_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "issue_reports_id_uidx" ON "issue_reports" ("id");
CREATE INDEX IF NOT EXISTS "issue_reports_user_idx" ON "issue_reports" ("user_id");
CREATE INDEX IF NOT EXISTS "issue_reports_type_idx" ON "issue_reports" ("report_type");
CREATE INDEX IF NOT EXISTS "issue_reports_created_idx" ON "issue_reports" ("created_at");
