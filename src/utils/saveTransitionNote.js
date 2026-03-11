// Saves a transition note as a proper Note record so it appears
// on the patient's Notes tab.  Called after a successful stage change.
import { createNote } from '../api/notes.js';

export async function saveTransitionNote({ referral, fromStage, toStage, note, authorId }) {
  if (!note?.trim() || !referral?.patient_id) return;

  const content = `[${fromStage} → ${toStage}]\n${note.trim()}`;

  try {
    await createNote({
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      patient_id: referral.patient_id,
      referral_id: referral.id || null,
      author_id: authorId || 'unknown',
      content,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Note save is best-effort — don't block or roll back the stage change
  }
}
