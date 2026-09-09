import aurora from './aurora.js';
const TABLE = 'UserPermissions';

export const getUserPermissions = (params) => aurora.fetchAll(TABLE, params);
export const getUserPermission = (id) => aurora.fetchOne(TABLE, id);
export const createUserPermission = (fields) => aurora.create(TABLE, fields);
export const updateUserPermission = (id, fields) => aurora.update(TABLE, id, fields);
