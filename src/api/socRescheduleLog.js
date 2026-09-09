import aurora from './aurora.js';

const TABLE = 'SocRescheduleLog';

export const createSocRescheduleLog = (fields) => aurora.create(TABLE, fields);

export const getSocRescheduleLogsByReferral = (referralId) =>
  aurora.fetchAll(TABLE, { filterByFormula: `{referral_id} = "${referralId}"` });
