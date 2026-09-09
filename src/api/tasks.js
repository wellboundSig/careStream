import aurora from './aurora.js';
const TABLE = 'Tasks';
export const getAllTasks = (params) =>
  aurora.fetchAll(TABLE, { sort: [{ field: 'due_date', direction: 'asc' }], ...params });
export const getMyTasks = (userId) =>
  aurora.fetchAll(TABLE, { filterByFormula: `{assigned_to_id} = "${userId}"`, sort: [{ field: 'due_date', direction: 'asc' }] });
export const getTasksByPatient = (patientId) =>
  aurora.fetchAll(TABLE, { filterByFormula: `{patient_id} = "${patientId}"`, sort: [{ field: 'due_date', direction: 'asc' }] });
export const getTasksByReferral = (referralId) =>
  aurora.fetchAll(TABLE, { filterByFormula: `{referral_id} = "${referralId}"` });
export const createTask = (fields) => aurora.create(TABLE, fields);
export const updateTask = (id, fields) => aurora.update(TABLE, id, fields);
