import aurora from './aurora.js';
const TABLE = 'InsuranceChecks';
export const getChecksByPatient = (patientId) =>
  aurora.fetchAll(TABLE, { filterByFormula: `{patient_id} = "${patientId}"`, sort: [{ field: 'check_date', direction: 'desc' }] });
export const createInsuranceCheck = (fields) => aurora.create(TABLE, fields);
