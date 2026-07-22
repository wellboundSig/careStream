import airtable from './airtable.js';

const TABLE = 'Notifications';

export const getNotificationsForUser = (userId, { maxRecords = 100 } = {}) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `{recipient_user_id} = "${userId}"`,
    sort: [{ field: 'created_at', direction: 'desc' }],
    maxRecords,
  });

export const createNotification = (fields) => airtable.create(TABLE, fields);

export const updateNotification = (recordId, fields) =>
  airtable.update(TABLE, recordId, fields);
