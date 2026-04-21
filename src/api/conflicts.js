/**
 * Conflicts API.
 *
 * Linked-record fields normalised at boundary. See
 * INSURANCE_CONSOLIDATION_PLAN.md for the list of structured
 * `conflict_reasons` options that must exist in Airtable; the code writes
 * from src/data/eligibilityEnums.js and will fail cleanly if the Airtable
 * singleSelect is missing an option.
 */

import airtable from './airtable.js';
import { toLinks } from './_linkHelpers.js';

const TABLE = 'Conflicts';

const LINK_FIELDS = ['patient_id', 'created_by_id', 'resolved_by_id'];

function normaliseFields(fields) {
  if (!fields) return fields;
  const out = { ...fields };
  for (const f of LINK_FIELDS) {
    if (f in out) {
      const v = toLinks(out[f]);
      if (v === undefined) delete out[f];
      else out[f] = v;
    }
  }
  // Strip null/undefined — Airtable rejects nulls on single-line text fields.
  for (const k of Object.keys(out)) {
    if (out[k] === null || out[k] === undefined) delete out[k];
  }
  return out;
}

export const getConflictsByReferral = (referralId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{referral_id} = "${referralId}"` });

export const getConflictsByPatient = (patientId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `FIND("${patientId}", ARRAYJOIN({patient_id}))` });

export const createConflict = (fields) => airtable.create(TABLE, normaliseFields(fields));
export const updateConflict = (id, fields) => airtable.update(TABLE, id, normaliseFields(fields));
