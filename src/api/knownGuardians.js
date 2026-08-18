// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from './airtable.js';

const GUARDIANS = 'KnownGuardians';
const LINKS = 'PatientGuardians';

export const getKnownGuardians = () =>
  airtable.fetchAll(GUARDIANS, { sort: [{ field: 'display_name', direction: 'asc' }] });
export const createKnownGuardian = (fields) => airtable.create(GUARDIANS, fields);
export const updateKnownGuardian = (id, fields) => airtable.update(GUARDIANS, id, fields);

export const getPatientGuardians = (opts = {}) => airtable.fetchAll(LINKS, opts);
export const createPatientGuardian = (fields) => airtable.create(LINKS, fields);
export const updatePatientGuardian = (id, fields) => airtable.update(LINKS, id, fields);
export const deletePatientGuardian = (id) => airtable.remove(LINKS, id);
