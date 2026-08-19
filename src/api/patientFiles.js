// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
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

/** Load files by every known patient / referral identity (business id + rec_id). */
export async function fetchFilesForChart(patient, referral) {
  const pids = [...new Set([patient?.id, patient?._id].filter(Boolean).map(String))];
  const rids = [...new Set([referral?.id, referral?._id].filter(Boolean).map(String))];
  const jobs = [
    ...pids.map((id) => getFilesByPatient(id).then((rows) => ({ rows, ok: true })).catch((err) => ({ rows: [], ok: false, err }))),
    ...rids.map((id) => getFilesByReferral(id).then((rows) => ({ rows, ok: true })).catch((err) => ({ rows: [], ok: false, err }))),
  ];
  if (!jobs.length) return [];
  const results = await Promise.all(jobs);
  if (results.every((r) => !r.ok)) {
    throw results[0].err || new Error('Could not load files');
  }
  return results.flatMap((r) => r.rows);
}
export const createFile = (fields) => airtable.create(TABLE, fields);
export const updateFile = (id, fields) => airtable.update(TABLE, id, fields);
export const deleteFile = (id) => airtable.remove(TABLE, id);
