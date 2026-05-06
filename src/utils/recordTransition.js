// recordTransition — called on every stage change, regardless of whether a
// note is provided. Writes a StageHistory audit record (always) and a Note
// record visible on the patient's timeline (only when a note is provided).

import { createStageHistory } from '../api/stageHistory.js';
import { createNote } from '../api/notes.js';
import { mergeEntities } from '../store/careStore.js';

export async function recordTransition({ referral, fromStage, toStage, note, authorId }) {
  const now = new Date().toISOString();

  // ── 1. StageHistory record — always written ──────────────────────────────
  // Airtable StageHistory uses single-select fields for referral_id and changed_by_id
  // (logical keys like ref_001 / usr_001), not Airtable record ids (recXXX).
  // Never fall back to referral._id — it triggers 422 Invalid enum value.
  const historyFields = {
    id:        `sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    to_stage:  toStage,
    timestamp: now,
  };
  if (referral?.id) historyFields.referral_id = referral.id;
  if (authorId) historyFields.changed_by_id = authorId;
  if (fromStage) historyFields.from_stage = fromStage;
  if (note?.trim()) historyFields.reason = note.trim();

  // Optimistically mirror the new history row into the in-memory store so
  // metrics that depend on StageHistory ("days in stage") reset to 0 *now*,
  // instead of waiting for the next hot-table poll.
  const tempId = `_pending_sh_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`;
  try {
    mergeEntities('stageHistory', {
      [tempId]: { _id: tempId, ...historyFields },
    });
  } catch {}

  createStageHistory(historyFields)
    .then((rec) => {
      if (rec?.id) {
        try {
          // Replace the temp row with the real one keyed by Airtable record id.
          mergeEntities('stageHistory', {
            [rec.id]: { _id: rec.id, ...rec.fields },
          });
        } catch {}
      }
    })
    .catch((err) => {
      console.warn('[recordTransition] StageHistory create failed (audit row skipped):', err?.message || err);
      // Best-effort — must not block the referral stage update.
    });

  // ── 2. Note record — only when a note was provided ───────────────────────
  if (!note?.trim() || !referral?.patient_id) return;

  const content = `[${fromStage} → ${toStage}]\n${note.trim()}`;

  createNote({
    id:          `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    patient_id:  referral.patient_id,
    referral_id: referral.id || null,
    ...(authorId ? { author_id: authorId } : {}),
    content,
    is_pinned:   false,
    created_at:  now,
    updated_at:  now,
  }).catch(() => {
    // Note write is also best-effort.
  });
}
