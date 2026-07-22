-- 0015_physician_title.sql — Provider credential/title from NPPES (NP, PA, MD, …).

ALTER TABLE "physicians" ADD COLUMN IF NOT EXISTS "title" text;
