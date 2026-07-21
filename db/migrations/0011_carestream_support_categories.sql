-- 0011_carestream_support_categories.sql
-- Office Support portal topics (route to In-house IT — not ID Tech / Dataphone).
-- Uses the same rec_ids already created in Airtable so environments stay aligned.

INSERT INTO "categories" ("rec_id", "name", "sort_order", "active", "team_id", "field_topic")
SELECT
  'reccwdmPSlVqS6hj6',
  'CareStream Access request',
  245,
  true,
  t."rec_id",
  false
FROM "teams" t
WHERE t."name" = 'In-house IT'
  AND NOT EXISTS (
    SELECT 1 FROM "categories" c
    WHERE c."rec_id" = 'reccwdmPSlVqS6hj6'
       OR c."name" = 'CareStream Access request'
  );

INSERT INTO "categories" ("rec_id", "name", "sort_order", "active", "team_id", "field_topic")
SELECT
  'recXbCQKvTswaWhya',
  'CareStream Password Reset',
  75,
  true,
  t."rec_id",
  false
FROM "teams" t
WHERE t."name" = 'In-house IT'
  AND NOT EXISTS (
    SELECT 1 FROM "categories" c
    WHERE c."rec_id" = 'recXbCQKvTswaWhya'
       OR c."name" = 'CareStream Password Reset'
  );
