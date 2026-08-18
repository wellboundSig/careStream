// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';
export const getRoles = () => airtable.fetchAll('Roles');
export const updateRole = (id, fields) => airtable.update('Roles', id, fields);
