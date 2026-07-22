-- 0017_notifications.sql — In-app notifications (e.g. note @mentions).
-- One row per recipient event. Indexed for recipient inbox queries.
-- Mentions are also encoded in note content as @[Display Name](user_id);
-- this table is the delivery / read-state record (efficient ERD: no join table).

CREATE TABLE IF NOT EXISTS "notifications" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "recipient_user_id" text NOT NULL,
  "actor_user_id" text,
  "type" text NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "patient_id" text,
  "referral_id" text,
  "title" text,
  "body" text,
  "is_read" boolean DEFAULT false,
  "created_at" timestamptz,
  "updated_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_id_uidx" ON "notifications" ("id");
CREATE INDEX IF NOT EXISTS "notifications_recipient_unread_idx"
  ON "notifications" ("recipient_user_id", "is_read", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "notifications_entity_idx"
  ON "notifications" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "notifications_created_idx"
  ON "notifications" ("created_at" DESC);

DROP TRIGGER IF EXISTS "trg_notifications_touch" ON "notifications";
CREATE TRIGGER "trg_notifications_touch"
  BEFORE UPDATE ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
