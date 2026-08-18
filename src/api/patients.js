// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';

const TABLE = 'Patients';

export const getPatients = (params) => airtable.fetchAll(TABLE, params);
export const getPatient = (id) => airtable.fetchOne(TABLE, id);
export const createPatient = (fields) => airtable.create(TABLE, fields);
export const updatePatient = (id, fields) => airtable.update(TABLE, id, fields);
export const deletePatient = (id) => airtable.remove(TABLE, id);
