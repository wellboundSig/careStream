import aurora from './aurora.js';

const TABLE = 'Referrals';

export const getReferrals = (params) => aurora.fetchAll(TABLE, params);
export const getReferral = (id) => aurora.fetchOne(TABLE, id);
export const createReferral = (fields) => aurora.create(TABLE, fields);
export const updateReferral = (id, fields) => aurora.update(TABLE, id, fields);
export const deleteReferral = (id) => aurora.remove(TABLE, id);
