import airtable from './airtable.js';
const TABLE = 'Files';
export const getFilesByPatient = (patientId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{patient_id} = "${patientId}"`, sort: [{ field: 'created_at', direction: 'desc' }] });
export const createFile = (fields) => airtable.create(TABLE, fields);
export const deleteFile = (id) => airtable.remove(TABLE, id);
