/**
 * PatientInsurances API — the canonical source of truth for a patient's
 * insurance coverage set.
 *
 * Soft-delete: set `termination_date` (YYYY-MM-DD). The Airtable-wire API
 * omits false checkboxes, so `is_active_raw: false` alone cannot be read
 * back reliably — termination_date is the durable signal.
 */

import airtable from './airtable.js';
import { toLinks } from './_linkHelpers.js';

const TABLE = 'PatientInsurances';

const LINK_FIELDS = ['patient_id'];
/** Null must reach the API so soft-delete can be cleared on re-add. */
const NULLABLE_FIELDS = new Set(['termination_date']);

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
  for (const k of Object.keys(out)) {
    if (out[k] === null || out[k] === undefined) {
      if (!NULLABLE_FIELDS.has(k)) delete out[k];
    }
  }
  return out;
}

/** Active coverage: no termination_date (and not explicitly inactive). */
export function isInsuranceActive(rowOrFields) {
  const fields = rowOrFields?.fields ? rowOrFields.fields : rowOrFields;
  if (!fields) return false;
  if (fields.is_active_raw === false) return false;
  const term = fields.termination_date;
  if (term != null && String(term).trim() !== '') return false;
  return true;
}

/**
 * @param {string} patientId  Patient business id (`pat_…`)
 * @param {{ includeInactive?: boolean }} [opts]
 */
export async function getInsurancesByPatient(patientId, opts = {}) {
  const { includeInactive = false } = opts;
  const records = await airtable.fetchAll(TABLE, {
    filterByFormula: `FIND("${patientId}", ARRAYJOIN({patient_id}))`,
    sort: [{ field: 'order_rank', direction: 'asc' }, { field: 'created_at', direction: 'asc' }],
  });
  if (includeInactive) return records;
  return records.filter((r) => isInsuranceActive(r));
}

export const createPatientInsurance = (fields) => airtable.create(TABLE, normaliseFields(fields));
export const updatePatientInsurance = (id, fields) => airtable.update(TABLE, id, normaliseFields(fields));
export const deletePatientInsurance = (id) => airtable.remove(TABLE, id);
