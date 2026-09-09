/**
 * Conflicts API.
 *
 * Linked-record fields normalised at boundary. See
 * INSURANCE_CONSOLIDATION_PLAN.md for the list of structured
 * `conflict_reasons` options that must exist in Aurora; the code writes
 * from src/data/eligibilityEnums.js and will fail cleanly if the Aurora
 * singleSelect is missing an option.
 */

import aurora from './aurora.js';

const TABLE = 'Conflicts';

function normaliseFields(fields) {
  if (!fields) return fields;
  const out = { ...fields };
  // Strip null/undefined — Aurora rejects nulls on single-line text fields.
  for (const k of Object.keys(out)) {
    if (out[k] === null || out[k] === undefined) delete out[k];
  }
  return out;
}

export const getConflictsByReferral = (referralId) =>
  aurora.fetchAll(TABLE, { filterByFormula: `{referral_id} = "${referralId}"` });

export const getConflictsByPatient = (patientId) =>
  aurora.fetchAll(TABLE, { filterByFormula: `FIND("${patientId}", ARRAYJOIN({patient_id}))` });

export const createConflict = (fields) => aurora.create(TABLE, normaliseFields(fields));
export const updateConflict = (id, fields) => aurora.update(TABLE, id, normaliseFields(fields));
