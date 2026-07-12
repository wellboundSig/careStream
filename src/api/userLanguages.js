import airtable from './airtable.js';

const TABLE = 'UserLanguages';

export const getUserLanguages = (params) => airtable.fetchAll(TABLE, params);
export const createUserLanguage = (fields) => airtable.create(TABLE, fields);
export const deleteUserLanguage = (id) => airtable.remove(TABLE, id);

/**
 * Sync a user's language set to match `languageIds`.
 * Creates missing rows and deletes extras. Returns the final list of store records.
 */
export async function syncUserLanguages(userId, languageIds, existingRecords = []) {
  const desired = new Set(languageIds);
  const byLang = new Map();
  for (const rec of existingRecords) {
    if (rec.user_id === userId) byLang.set(rec.language_id, rec);
  }

  const kept = [];
  const removed = [];

  for (const [langId, rec] of byLang) {
    if (desired.has(langId)) {
      kept.push(rec);
      desired.delete(langId);
    } else if (rec._id) {
      await deleteUserLanguage(rec._id);
      removed.push(rec._id);
    }
  }

  const created = [];
  const now = new Date().toISOString();
  for (const languageId of desired) {
    const fields = {
      id: `ul_${userId}_${languageId}`,
      user_id: userId,
      language_id: languageId,
      created_at: now,
      updated_at: now,
    };
    const rec = await createUserLanguage(fields);
    created.push({ _id: rec.id, ...rec.fields });
  }

  return { created, removed, kept: [...kept, ...created] };
}
