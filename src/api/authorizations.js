import airtable from './airtable.js';
const TABLE = 'Authorizations';
export const getAuthorizationsByReferral = (referralId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{referral_id} = "${referralId}"` });
export const createAuthorization = (fields) => airtable.create(TABLE, fields);
export const updateAuthorization = (id, fields) => airtable.update(TABLE, id, fields);
