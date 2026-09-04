-- 0034_task_reminders.sql
-- Staff can schedule a reminder relative to a task's due / scheduled time.

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "reminder_preset" text,
  ADD COLUMN IF NOT EXISTS "reminder_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamptz;

CREATE INDEX IF NOT EXISTS "tasks_reminder_due_idx"
  ON "tasks" ("reminder_at")
  WHERE "reminder_at" IS NOT NULL AND "reminder_sent_at" IS NULL;
