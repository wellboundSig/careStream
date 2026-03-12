import airtable from './airtable.js';
const TABLE = 'Files';
export const getFilesByPatient = (patientId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{patient_id} = "${patientId}"`, sort: [{ field: 'created_at', direction: 'desc' }] });
export const getFilesByReferral = (referralId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{referral_id} = "${referralId}"`, sort: [{ field: 'created_at', direction: 'desc' }] });
// Batch fetch — returns all files for a set of patient IDs in one API call
export const getFilesForPatients = (patientIds) => {
  if (!patientIds.length) return Promise.resolve([]);
  const formula = `OR(${patientIds.map((id) => `{patient_id} = "${id}"`).join(',')})`;
  return airtable.fetchAll(TABLE, { filterByFormula: formula });
};
export const createFile = (fields) => airtable.create(TABLE, fields);
export const deleteFile = (id) => airtable.remove(TABLE, id);
