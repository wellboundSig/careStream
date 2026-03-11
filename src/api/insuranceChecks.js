import airtable from './airtable.js';
const TABLE = 'InsuranceChecks';
export const getChecksByPatient = (patientId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{patient_id} = "${patientId}"`, sort: [{ field: 'check_date', direction: 'desc' }] });
export const createInsuranceCheck = (fields) => airtable.create(TABLE, fields);
