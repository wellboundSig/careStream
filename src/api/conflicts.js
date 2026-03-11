import airtable from './airtable.js';
const TABLE = 'Conflicts';
export const getConflictsByReferral = (referralId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{referral_id} = "${referralId}"` });
export const createConflict = (fields) => airtable.create(TABLE, fields);
export const updateConflict = (id, fields) => airtable.update(TABLE, id, fields);
