import airtable from './airtable.js';
export const getRoles = () => airtable.fetchAll('Roles');
export const updateRole = (id, fields) => airtable.update('Roles', id, fields);
