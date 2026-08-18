-- 0032_table_scroll_mode_pref.sql
-- Per-user table scroll: 'full' (default, entire grid moves) or 'locked' (Excel freeze panes).

ALTER TABLE "user_preferences"
  ADD COLUMN IF NOT EXISTS "table_scroll_mode" text;
