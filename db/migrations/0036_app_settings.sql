-- 0036_app_settings.sql
-- Org-wide key/value settings (Global Configuration). Values are text so
-- false is never dropped by the checkbox wire (empty/omitted = use default).

CREATE TABLE IF NOT EXISTS "app_settings" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "key" text NOT NULL,
  "value" text,
  "updated_by_id" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "app_settings_key_uidx" ON "app_settings" ("key");
CREATE UNIQUE INDEX IF NOT EXISTS "app_settings_id_uidx" ON "app_settings" ("id");
CREATE INDEX IF NOT EXISTS "idx_app_settings_updated_at" ON "app_settings" ("updated_at");

DROP TRIGGER IF EXISTS "trg_app_settings_touch" ON "app_settings";
CREATE TRIGGER "trg_app_settings_touch"
  BEFORE UPDATE ON "app_settings"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Defaults: ALF requires clinical pre-check; Special Needs does not.
INSERT INTO "app_settings" ("id", "key", "value")
VALUES
  ('setting_require_clinical_precheck_alf', 'require_clinical_precheck_alf', 'true'),
  ('setting_require_clinical_precheck_sn',  'require_clinical_precheck_sn',  'false')
ON CONFLICT ("key") DO NOTHING;
