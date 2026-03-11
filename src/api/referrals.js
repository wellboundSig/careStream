import airtable from './airtable.js';

const TABLE = 'Referrals';

export const getReferrals = (params) => airtable.fetchAll(TABLE, params);
export const getReferral = (id) => airtable.fetchOne(TABLE, id);
export const createReferral = (fields) => airtable.create(TABLE, fields);
export const updateReferral = (id, fields) => airtable.update(TABLE, id, fields);
export const deleteReferral = (id) => airtable.remove(TABLE, id);
