/**
 * EligibilityVerifications API — verification events per insurance.
 *
 * Linked-record fields in Airtable require array values. We normalise at
 * this boundary so callers can pass a plain string id and be correct.
 */

import airtable from './airtable.js';
import { toLinks } from './_linkHelpers.js';

const TABLE = 'EligibilityVerifications';

// patient_id, insurance_id, and verified_by_user_id are all multipleRecordLinks.
const LINK_FIELDS = ['patient_id', 'insurance_id', 'verified_by_user_id'];

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
    if (out[k] === null || out[k] === undefined) delete out[k];
  }
  return out;
}

export const getVerificationsByPatient = (patientId) =>
  airtable.fetchAll(TABLE, {
    // linked-record filter in Airtable uses FIND against a rendered cell
    filterByFormula: `FIND("${patientId}", ARRAYJOIN({patient_id}))`,
    sort: [{ field: 'verification_date_time', direction: 'desc' }],
  });

export const getVerificationsByInsurance = (insuranceId) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `FIND("${insuranceId}", ARRAYJOIN({insurance_id}))`,
    sort: [{ field: 'verification_date_time', direction: 'desc' }],
  });

export const createEligibilityVerification = (fields) =>
  airtable.create(TABLE, normaliseFields(fields));
export const updateEligibilityVerification = (id, fields) =>
  airtable.update(TABLE, id, normaliseFields(fields));
