import aurora from './aurora.js';
const TABLE = 'Facilities';

export const getFacilities = (params) =>
  aurora.fetchAll(TABLE, { sort: [{ field: 'name', direction: 'asc' }], ...params });

export const getFacility = (id) => aurora.fetchOne(TABLE, id);
export const updateFacility = (id, fields) => aurora.update(TABLE, id, fields);
export const createFacility = (fields) => aurora.create(TABLE, fields);
