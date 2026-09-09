import aurora from './aurora.js';

export const getTriageAdult = (referralId) =>
  aurora.fetchAll('TriageAdult', { filterByFormula: `{referral_id} = "${referralId}"`, maxRecords: 1 });
export const createTriageAdult = (fields) => aurora.create('TriageAdult', fields);
export const updateTriageAdult = (id, fields) => aurora.update('TriageAdult', id, fields);

export const getTriagePediatric = (referralId) =>
  aurora.fetchAll('TriagePediatric', { filterByFormula: `{referral_id} = "${referralId}"`, maxRecords: 1 });
export const createTriagePediatric = (fields) => aurora.create('TriagePediatric', fields);
export const updateTriagePediatric = (id, fields) => aurora.update('TriagePediatric', id, fields);
