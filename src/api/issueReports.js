import aurora from './aurora.js';

const TABLE = 'IssueReports';

export const getIssueReports = (params) => aurora.fetchAll(TABLE, params);
export const createIssueReport = (fields) => aurora.create(TABLE, fields);
export const updateIssueReport = (id, fields) => aurora.update(TABLE, id, fields);
