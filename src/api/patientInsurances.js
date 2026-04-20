/**
 * PatientInsurances API — the canonical source of truth for a patient's
 * insurance coverage set.
 *
 * See INSURANCE_CONSOLIDATION_PLAN.md for the consolidation decision and
 * migration from the legacy JSON columns on the Patients table.
 *
 * Linked-record fields (patient_id) are normalised to array form at this
 * API boundary.
 */

import airtable from './airtable.js';
import { toLinks } from './_linkHelpers.js';

const TABLE = 'PatientInsurances';

const LINK_FIELDS = ['patient_id'];

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
  return out;
}

export const getInsurancesByPatient = (patientId) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `FIND("${patientId}", ARRAYJOIN({patient_id}))`,
    sort: [{ field: 'order_rank', direction: 'asc' }, { field: 'created_at', direction: 'asc' }],
  });

export const createPatientInsurance = (fields) => airtable.create(TABLE, normaliseFields(fields));
export const updatePatientInsurance = (id, fields) => airtable.update(TABLE, id, normaliseFields(fields));
export const deletePatientInsurance = (id) => airtable.remove(TABLE, id);
