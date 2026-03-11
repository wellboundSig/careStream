import airtable from './airtable.js';
const TABLE = 'Facilities';

export const getFacilities = (params) =>
  airtable.fetchAll(TABLE, { sort: [{ field: 'name', direction: 'asc' }], ...params });

export const getFacility = (id) => airtable.fetchOne(TABLE, id);
export const updateFacility = (id, fields) => airtable.update(TABLE, id, fields);
export const createFacility = (fields) => airtable.create(TABLE, fields);
