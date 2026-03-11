import airtable from './airtable.js';
export const getRoles = () => airtable.fetchAll('Roles');
