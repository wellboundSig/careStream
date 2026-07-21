import airtable from './airtable.js';

const TABLE = 'SocRescheduleLog';

export const createSocRescheduleLog = (fields) => airtable.create(TABLE, fields);

export const getSocRescheduleLogsByReferral = (referralId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{referral_id} = "${referralId}"` });
