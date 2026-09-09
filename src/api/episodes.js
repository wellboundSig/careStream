import aurora from './aurora.js';

const TABLE = 'Episodes';

export const getEpisodesByPatient = (patientId) =>
  aurora.fetchAll(TABLE, { filterByFormula: `{patient_id} = '${patientId}'` });

export const createEpisode = (fields) => aurora.create(TABLE, fields);
export const updateEpisode = (id, fields) => aurora.update(TABLE, id, fields);
