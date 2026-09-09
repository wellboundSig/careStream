import aurora from './aurora.js';

// Admin-managed list of conflict categories (the structured "reasons" staff
// pick when routing a referral to Conflict). Free-text-backed in Aurora;
// see src/data/conflictCategories.js for the effective-list resolution and
// static fallback used before this table is seeded.
const TABLE = 'ConflictCategories';

export const getConflictCategories = (params) => aurora.fetchAll(TABLE, params);
export const getConflictCategory = (id) => aurora.fetchOne(TABLE, id);
export const createConflictCategory = (fields) => aurora.create(TABLE, fields);
export const updateConflictCategory = (id, fields) => aurora.update(TABLE, id, fields);
export const deleteConflictCategory = (id) => aurora.remove(TABLE, id);
