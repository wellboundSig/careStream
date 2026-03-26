import airtable from './airtable.js';
const TABLE = 'ActivityLog';
export const getActivityLog = (params) => airtable.fetchAll(TABLE, { sort: [{ field: 'timestamp', direction: 'desc' }], ...params });
export const getActivityByUser = (userId, limit = 30) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{actor_id} = "${userId}"`, sort: [{ field: 'timestamp', direction: 'desc' }], maxRecords: limit });
