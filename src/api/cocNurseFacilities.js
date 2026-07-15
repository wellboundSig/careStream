import airtable from './airtable.js';

const TABLE = 'CocNurseFacilities';

export const getCocNurseFacilities = (params) => airtable.fetchAll(TABLE, params);
export const createCocNurseFacility = (fields) => airtable.create(TABLE, fields);
export const deleteCocNurseFacility = (id) => airtable.remove(TABLE, id);

/**
 * Sync a user's COC facility set to match `facilityIds` (NetworkFacilities ids).
 * Creates missing rows and deletes extras.
 */
export async function syncCocNurseFacilities(userId, facilityIds, existingRecords = []) {
  const desired = new Set(facilityIds);
  const byFac = new Map();
  for (const rec of existingRecords) {
    if (rec.user_id === userId) byFac.set(rec.facility_id, rec);
  }

  const kept = [];
  const removed = [];

  for (const [facId, rec] of byFac) {
    if (desired.has(facId)) {
      kept.push(rec);
      desired.delete(facId);
    } else if (rec._id) {
      await deleteCocNurseFacility(rec._id);
      removed.push(rec._id);
    }
  }

  const created = [];
  const now = new Date().toISOString();
  for (const facilityId of desired) {
    const fields = {
      id: `cnf_${userId}_${facilityId}`,
      user_id: userId,
      facility_id: facilityId,
      created_at: now,
      updated_at: now,
    };
    const rec = await createCocNurseFacility(fields);
    created.push({ _id: rec.id, ...rec.fields });
  }

  return { created, removed, kept: [...kept, ...created] };
}
