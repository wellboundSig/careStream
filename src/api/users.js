import airtable from './airtable.js';

const TABLE = 'Users';

export const getUsers = (params) => airtable.fetchAll(TABLE, params);
export const getUser = (id) => airtable.fetchOne(TABLE, id);
export const getUserByClerkId = (clerkId) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `{clerk_user_id} = "${clerkId}"`,
    maxRecords: 1,
  });
export const createUser = (fields) => airtable.create(TABLE, fields);
export const updateUser = (id, fields) => airtable.update(TABLE, id, fields);
