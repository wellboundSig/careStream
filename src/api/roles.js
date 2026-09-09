import aurora from './aurora.js';
export const getRoles = () => aurora.fetchAll('Roles');
export const updateRole = (id, fields) => aurora.update('Roles', id, fields);
