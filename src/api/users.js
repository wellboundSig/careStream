import aurora from './aurora.js';

const TABLE = 'Users';

export const getUsers = (params) => aurora.fetchAll(TABLE, params);
export const getUser = (id) => aurora.fetchOne(TABLE, id);
export const getUserByClerkId = (clerkId) =>
  aurora.fetchAll(TABLE, {
    filterByFormula: `{clerk_user_id} = "${clerkId}"`,
    maxRecords: 1,
  });
export const createUser = (fields) => aurora.create(TABLE, fields);
export const updateUser = (id, fields) => aurora.update(TABLE, id, fields);
