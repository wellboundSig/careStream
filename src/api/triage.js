import airtable from './airtable.js';

export const getTriageAdult = (referralId) =>
  airtable.fetchAll('TriageAdult', { filterByFormula: `{referral_id} = "${referralId}"`, maxRecords: 1 });
export const createTriageAdult = (fields) => airtable.create('TriageAdult', fields);
export const updateTriageAdult = (id, fields) => airtable.update('TriageAdult', id, fields);

export const getTriagePediatric = (referralId) =>
  airtable.fetchAll('TriagePediatric', { filterByFormula: `{referral_id} = "${referralId}"`, maxRecords: 1 });
export const createTriagePediatric = (fields) => airtable.create('TriagePediatric', fields);
export const updateTriagePediatric = (id, fields) => airtable.update('TriagePediatric', id, fields);
