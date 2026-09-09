import aurora from './aurora.js';
const TABLE = 'ReferralSources';
export const getReferralSources = () => aurora.fetchAll(TABLE);
export const createReferralSource = (fields) => aurora.create(TABLE, fields);
export const updateReferralSource = (id, fields) => aurora.update(TABLE, id, fields);
