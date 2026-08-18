// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';
const TABLE = 'Notes';
export const getNotesByPatient = (patientId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{patient_id} = "${patientId}"`, sort: [{ field: 'created_at', direction: 'desc' }] });
export const createNote = (fields) => airtable.create(TABLE, fields);
export const updateNote = (id, fields) => airtable.update(TABLE, id, fields);
export const deleteNote = (id) => airtable.remove(TABLE, id);
