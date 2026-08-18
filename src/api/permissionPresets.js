// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';
const TABLE = 'PermissionPresets';

export const getPermissionPresets = (params) => airtable.fetchAll(TABLE, params);
export const getPermissionPreset = (id) => airtable.fetchOne(TABLE, id);
export const createPermissionPreset = (fields) => airtable.create(TABLE, fields);
export const updatePermissionPreset = (id, fields) => airtable.update(TABLE, id, fields);
export const deletePermissionPreset = (id) => airtable.remove(TABLE, id);
