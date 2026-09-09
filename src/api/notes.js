import aurora from './aurora.js';
const TABLE = 'Notes';
export const getNotesByPatient = (patientId) =>
  aurora.fetchAll(TABLE, { filterByFormula: `{patient_id} = "${patientId}"`, sort: [{ field: 'created_at', direction: 'desc' }] });
export const getNoteByBusinessId = (noteId) => {
  if (!noteId) return Promise.resolve([]);
  return aurora.fetchAll(TABLE, { filterByFormula: `{id} = "${noteId}"`, maxRecords: 1 });
};
export const createNote = (fields) => aurora.create(TABLE, fields);
export const updateNote = (id, fields) => aurora.update(TABLE, id, fields);
export const deleteNote = (id) => aurora.remove(TABLE, id);
