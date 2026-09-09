import aurora from './aurora.js';

const GUARDIANS = 'KnownGuardians';
const LINKS = 'PatientGuardians';

export const getKnownGuardians = () =>
  aurora.fetchAll(GUARDIANS, { sort: [{ field: 'display_name', direction: 'asc' }] });
export const createKnownGuardian = (fields) => aurora.create(GUARDIANS, fields);
export const updateKnownGuardian = (id, fields) => aurora.update(GUARDIANS, id, fields);

export const getPatientGuardians = (opts = {}) => aurora.fetchAll(LINKS, opts);
export const createPatientGuardian = (fields) => aurora.create(LINKS, fields);
export const updatePatientGuardian = (id, fields) => aurora.update(LINKS, id, fields);
export const deletePatientGuardian = (id) => aurora.remove(LINKS, id);
