// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';
const TABLE = 'StageHistory';

export const getStageHistory = (referralId) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `{referral_id} = "${referralId}"`,
    sort: [{ field: 'timestamp', direction: 'desc' }],
  });

export const createStageHistory = (fields, opts) => airtable.create(TABLE, fields, opts);
