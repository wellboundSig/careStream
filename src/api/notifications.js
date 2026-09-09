import aurora from './aurora.js';

const TABLE = 'Notifications';

export const getNotificationsForUser = (userId, { maxRecords = 100 } = {}) =>
  aurora.fetchAll(TABLE, {
    filterByFormula: `{recipient_user_id} = "${userId}"`,
    sort: [{ field: 'created_at', direction: 'desc' }],
    maxRecords,
  });

export const createNotification = (fields) => aurora.create(TABLE, fields);

export const updateNotification = (recordId, fields) =>
  aurora.update(TABLE, recordId, fields);
