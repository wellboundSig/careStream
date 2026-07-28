-- 0022_unassigned_role.sql
-- Default role for brand-new Clerk signups. Managers must assign a real role
-- and permissions before the user can access ALF/SPN patient data.

INSERT INTO "roles" (
  "rec_id", "id", "name", "description", "default_preset_id", "created_at", "updated_at"
)
SELECT
  'rec_rol_unassigned',
  'rol_016',
  'Unassigned',
  'Pending setup — no division or feature access until a manager assigns a role.',
  NULL,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE "id" = 'rol_016'
);

UPDATE "roles"
SET
  "name" = 'Unassigned',
  "description" = 'Pending setup — no division or feature access until a manager assigns a role.',
  "updated_at" = NOW()
WHERE "id" = 'rol_016';
