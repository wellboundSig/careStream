// recordTransition — called on every stage change, regardless of whether a
// note is provided. Writes a StageHistory audit record (always) and a Note
// record visible on the patient's timeline (only when a note is provided).

import { createStageHistory } from '../api/stageHistory.js';
import { createNote } from '../api/notes.js';

export async function recordTransition({ referral, fromStage, toStage, note, authorId }) {
  const now = new Date().toISOString();

  // ── 1. StageHistory record — always written ──────────────────────────────
  // This is the backbone of time-in-stage metrics and the audit trail.
  const historyFields = {
    id:            `sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    referral_id:   referral.id || referral._id,
    to_stage:      toStage,
    changed_by_id: authorId || 'unknown',
    timestamp:     now,
  };
  if (fromStage) historyFields.from_stage = fromStage;
  if (note?.trim()) historyFields.reason = note.trim();

  createStageHistory(historyFields).catch(() => {
    // StageHistory write is best-effort — a failure here must not block
    // or roll back the stage transition itself.
  });

  // ── 2. Note record — only when a note was provided ───────────────────────
  if (!note?.trim() || !referral?.patient_id) return;

  const content = `[${fromStage} → ${toStage}]\n${note.trim()}`;

  createNote({
    id:          `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    patient_id:  referral.patient_id,
    referral_id: referral.id || null,
    author_id:   authorId || 'unknown',
    content,
    is_pinned:   false,
    created_at:  now,
    updated_at:  now,
  }).catch(() => {
    // Note write is also best-effort.
  });
}
