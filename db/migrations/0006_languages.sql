-- 0006_languages.sql — Patient preferred language + Users ↔ Languages M2M.

ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "preferred_language" text;

CREATE TABLE IF NOT EXISTS "languages" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "code" text,
  "name" text,
  "sort_order" bigint,
  "is_active" boolean,
  "created_at" timestamptz,
  "updated_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "languages_id_uidx" ON "languages" ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "languages_code_uidx" ON "languages" ("code");

CREATE TABLE IF NOT EXISTS "user_languages" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "user_id" text,
  "language_id" text,
  "created_at" timestamptz,
  "updated_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_languages_id_uidx" ON "user_languages" ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "user_languages_user_lang_uidx"
  ON "user_languages" ("user_id", "language_id");
CREATE INDEX IF NOT EXISTS "user_languages_user_idx" ON "user_languages" ("user_id");
CREATE INDEX IF NOT EXISTS "user_languages_lang_idx" ON "user_languages" ("language_id");

-- Seed catalog (idempotent).
INSERT INTO "languages" ("id", "code", "name", "sort_order", "is_active", "created_at", "updated_at")
VALUES
  ('lang_en', 'en', 'English', 10, true, now(), now()),
  ('lang_es', 'es', 'Spanish', 20, true, now(), now()),
  ('lang_ht', 'ht', 'Haitian Creole', 30, true, now(), now()),
  ('lang_fr', 'fr', 'French', 40, true, now(), now()),
  ('lang_ru', 'ru', 'Russian', 50, true, now(), now()),
  ('lang_yi', 'yi', 'Yiddish', 60, true, now(), now()),
  ('lang_he', 'he', 'Hebrew', 70, true, now(), now()),
  ('lang_zh_cmn', 'zh-cmn', 'Mandarin', 80, true, now(), now()),
  ('lang_zh_yue', 'zh-yue', 'Cantonese', 90, true, now(), now()),
  ('lang_bn', 'bn', 'Bangla', 100, true, now(), now()),
  ('lang_hi', 'hi', 'Hindi', 110, true, now(), now()),
  ('lang_ur', 'ur', 'Urdu', 120, true, now(), now()),
  ('lang_ko', 'ko', 'Korean', 130, true, now(), now()),
  ('lang_vi', 'vi', 'Vietnamese', 140, true, now(), now()),
  ('lang_tl', 'tl', 'Tagalog', 150, true, now(), now()),
  ('lang_ja', 'ja', 'Japanese', 160, true, now(), now()),
  ('lang_ar', 'ar', 'Arabic', 170, true, now(), now()),
  ('lang_pt', 'pt', 'Portuguese', 180, true, now(), now()),
  ('lang_pl', 'pl', 'Polish', 190, true, now(), now()),
  ('lang_it', 'it', 'Italian', 200, true, now(), now())
ON CONFLICT ("id") DO NOTHING;
