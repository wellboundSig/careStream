// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';
const TABLE = 'ReferralSources';
export const getReferralSources = () => airtable.fetchAll(TABLE);
export const createReferralSource = (fields) => airtable.create(TABLE, fields);
export const updateReferralSource = (id, fields) => airtable.update(TABLE, id, fields);
