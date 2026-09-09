import aurora from './aurora.js';

const TABLE = 'AppSettings';

export const getAppSettings = (params) => aurora.fetchAll(TABLE, params);
export const createAppSetting = (fields) => aurora.create(TABLE, fields);
export const updateAppSetting = (id, fields) => aurora.update(TABLE, id, fields);
