import aurora from './aurora.js';
import { mergeEntities, useCareStore } from '../store/careStore.js';

const TABLE = 'MentionStates';

/**
 * Upsert the signed-in user's inbox state for one mention (note).
 * Optimistically merges into the store, then persists. Returns the store row.
 *
 * @param {string} userId  business user id (usr_…)
 * @param {string} noteId  business note id (note_…)
 * @param {object} fields  e.g. { is_done: true, done_at: iso } or { is_pinned: … }
 */
export async function setMentionState(userId, noteId, fields) {
  if (!userId || !noteId) throw new Error('userId and noteId required');
  const store = useCareStore.getState().mentionStates || {};
  const existing = Object.values(store).find((r) => r.user_id === userId && r.note_id === noteId);

  if (existing?._id) {
    const next = { ...existing, ...fields };
    mergeEntities('mentionStates', { [existing._id]: next });
    try {
      await aurora.update(TABLE, existing._id, fields);
    } catch (err) {
      mergeEntities('mentionStates', { [existing._id]: existing }); // revert
      throw err;
    }
    return next;
  }

  const now = new Date().toISOString();
  const create = {
    id: `ms_${userId}_${noteId}`,
    user_id: userId,
    note_id: noteId,
    created_at: now,
    updated_at: now,
    ...fields,
  };
  const rec = await aurora.create(TABLE, create);
  const row = { _id: rec.id, ...rec.fields };
  mergeEntities('mentionStates', { [rec.id]: row });
  return row;
}
