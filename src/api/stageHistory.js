import airtable from './airtable.js';
const TABLE = 'StageHistory';

export const getStageHistory = (referralId) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `{referral_id} = "${referralId}"`,
    sort: [{ field: 'timestamp', direction: 'desc' }],
  });

export const createStageHistory = (fields) => airtable.create(TABLE, fields);
