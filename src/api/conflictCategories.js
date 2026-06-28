import airtable from './airtable.js';

// Admin-managed list of conflict categories (the structured "reasons" staff
// pick when routing a referral to Conflict). Free-text-backed in Airtable;
// see src/data/conflictCategories.js for the effective-list resolution and
// static fallback used before this table is seeded.
const TABLE = 'ConflictCategories';

export const getConflictCategories = (params) => airtable.fetchAll(TABLE, params);
export const getConflictCategory = (id) => airtable.fetchOne(TABLE, id);
export const createConflictCategory = (fields) => airtable.create(TABLE, fields);
export const updateConflictCategory = (id, fields) => airtable.update(TABLE, id, fields);
export const deleteConflictCategory = (id) => airtable.remove(TABLE, id);
