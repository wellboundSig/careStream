import aurora from './aurora.js';
const TABLE = 'Permissions';

export const getPermissions = (params) => aurora.fetchAll(TABLE, params);
export const getPermission = (id) => aurora.fetchOne(TABLE, id);
export const createPermission = (fields) => aurora.create(TABLE, fields);
export const updatePermission = (id, fields) => aurora.update(TABLE, id, fields);
