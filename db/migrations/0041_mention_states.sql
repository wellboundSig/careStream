-- 0041_mention_states.sql — per-user inbox state for the Mentions page.
--
-- One row per (user, note): whether the user marked the mention Done and/or
-- pinned it. Purely personal workflow state — it never touches the note
-- itself (note pinning on the patient timeline is a separate, shared flag).

CREATE TABLE IF NOT EXISTS "mention_states" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "user_id" text,
  "note_id" text,
  "is_done" boolean,
  "done_at" timestamptz,
  "is_pinned" boolean,
  "pinned_at" timestamptz,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "mention_states_id_uidx" ON "mention_states" ("id");
CREATE UNIQUE INDEX IF NOT EXISTS "mention_states_user_note_uidx" ON "mention_states" ("user_id", "note_id");
CREATE INDEX IF NOT EXISTS "idx_mention_states_user_id" ON "mention_states" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_mention_states_updated_at" ON "mention_states" ("updated_at");

DROP TRIGGER IF EXISTS "trg_mention_states_touch" ON "mention_states";
CREATE TRIGGER "trg_mention_states_touch"
  BEFORE UPDATE ON "mention_states"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
