import airtable from './airtable.js';
const TABLE = 'Tasks';
export const getAllTasks = (params) =>
  airtable.fetchAll(TABLE, { sort: [{ field: 'due_date', direction: 'asc' }], ...params });
export const getMyTasks = (userId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{assigned_to_id} = "${userId}"`, sort: [{ field: 'due_date', direction: 'asc' }] });
export const getTasksByPatient = (patientId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{patient_id} = "${patientId}"`, sort: [{ field: 'due_date', direction: 'asc' }] });
export const getTasksByReferral = (referralId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{referral_id} = "${referralId}"` });
export const createTask = (fields) => airtable.create(TABLE, fields);
export const updateTask = (id, fields) => airtable.update(TABLE, id, fields);
