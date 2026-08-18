// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';

const TABLE = 'IssueReports';

export const getIssueReports = (params) => airtable.fetchAll(TABLE, params);
export const createIssueReport = (fields) => airtable.create(TABLE, fields);
export const updateIssueReport = (id, fields) => airtable.update(TABLE, id, fields);
