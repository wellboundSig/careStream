-- 0004_role_default_preset.sql — link each Role to an optional default PermissionPreset.
-- Used when assigning a role to a user: admin can apply the role's default permissions
-- or keep the user's current set. Null = name-only role (no default packet).

ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "default_preset_id" text;
