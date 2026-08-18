// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';
const TABLE = 'UserPermissions';

export const getUserPermissions = (params) => airtable.fetchAll(TABLE, params);
export const getUserPermission = (id) => airtable.fetchOne(TABLE, id);
export const createUserPermission = (fields) => airtable.create(TABLE, fields);
export const updateUserPermission = (id, fields) => airtable.update(TABLE, id, fields);
