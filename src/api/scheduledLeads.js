import aurora from './aurora.js';

const TABLE = 'ScheduledLeads';

export const getPendingScheduledLeads = ({ maxRecords = 200 } = {}) =>
  aurora.fetchAll(TABLE, {
    filterByFormula: '{status} = "pending"',
    sort: [{ field: 'go_live_at', direction: 'asc' }],
    maxRecords,
  });

export const createScheduledLead = (fields) => aurora.create(TABLE, fields);

export const updateScheduledLead = (recordId, fields) =>
  aurora.update(TABLE, recordId, fields);

export const deleteScheduledLead = (recordId) => aurora.remove(TABLE, recordId);
