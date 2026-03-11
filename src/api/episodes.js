import airtable from './airtable.js';

const TABLE = 'Episodes';

export const getEpisodesByPatient = (patientId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{patient_id} = '${patientId}'` });

export const createEpisode = (fields) => airtable.create(TABLE, fields);
export const updateEpisode = (id, fields) => airtable.update(TABLE, id, fields);
