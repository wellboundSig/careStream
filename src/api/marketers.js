import aurora from './aurora.js';

const TABLE = 'Marketers';

export const getMarketers = (params) => aurora.fetchAll(TABLE, params);
export const getMarketer = (id) => aurora.fetchOne(TABLE, id);
export const createMarketer = (fields) => aurora.create(TABLE, fields);
export const updateMarketer = (id, fields) => aurora.update(TABLE, id, fields);
