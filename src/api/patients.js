import aurora from './aurora.js';

const TABLE = 'Patients';

export const getPatients = (params) => aurora.fetchAll(TABLE, params);
export const getPatient = (id) => aurora.fetchOne(TABLE, id);
export const createPatient = (fields) => aurora.create(TABLE, fields);
export const updatePatient = (id, fields) => aurora.update(TABLE, id, fields);
export const deletePatient = (id) => aurora.remove(TABLE, id);
