import aurora from './aurora.js';
const TABLE = 'PermissionPresets';

export const getPermissionPresets = (params) => aurora.fetchAll(TABLE, params);
export const getPermissionPreset = (id) => aurora.fetchOne(TABLE, id);
export const createPermissionPreset = (fields) => aurora.create(TABLE, fields);
export const updatePermissionPreset = (id, fields) => aurora.update(TABLE, id, fields);
export const deletePermissionPreset = (id) => aurora.remove(TABLE, id);
