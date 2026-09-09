import aurora from './aurora.js';
const TABLE = 'Physicians';
export const getPhysicians = () => aurora.fetchAll(TABLE, { sort: [{ field: 'last_name', direction: 'asc' }] });
export const getPhysician = (id) => aurora.fetchOne(TABLE, id);
export const createPhysician = (fields) => aurora.create(TABLE, fields);
export const updatePhysician = (id, fields) => aurora.update(TABLE, id, fields);
