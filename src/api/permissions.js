import airtable from './airtable.js';
const TABLE = 'Permissions';

export const getPermissions = (params) => airtable.fetchAll(TABLE, params);
export const getPermission = (id) => airtable.fetchOne(TABLE, id);
export const createPermission = (fields) => airtable.create(TABLE, fields);
export const updatePermission = (id, fields) => airtable.update(TABLE, id, fields);
