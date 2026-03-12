import airtable from './airtable.js';
const TABLE = 'Physicians';
export const getPhysicians = () => airtable.fetchAll(TABLE, { sort: [{ field: 'last_name', direction: 'asc' }] });
export const getPhysician = (id) => airtable.fetchOne(TABLE, id);
export const createPhysician = (fields) => airtable.create(TABLE, fields);
export const updatePhysician = (id, fields) => airtable.update(TABLE, id, fields);
