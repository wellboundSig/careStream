/**
 * DisenrollmentAssistanceFlags API.
 *
 * Linked-record fields are normalised to array form at this boundary.
 */

import airtable from './airtable.js';
import { toLinks } from './_linkHelpers.js';

const TABLE = 'DisenrollmentAssistanceFlags';

// Inspect the live schema (scripts/schema-snapshot.json) — patient_id,
// referral_id, created_by_user_id, and follow_up_owner_user_id are all
// multipleRecordLinks on this table. Normalise them consistently.
const LINK_FIELDS = ['patient_id', 'referral_id', 'created_by_user_id', 'follow_up_owner_user_id', 'resolved_by_user_id'];

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

export const getDisenrollmentFlagsByPatient = (patientId) =>
  airtable.fetchAll(TABLE, {
    filterByFormula: `FIND("${patientId}", ARRAYJOIN({patient_id}))`,
    sort: [{ field: 'created_at', direction: 'desc' }],
  });

export const createDisenrollmentFlag = (fields) => airtable.create(TABLE, normaliseFields(fields));
export const updateDisenrollmentFlag = (id, fields) => airtable.update(TABLE, id, normaliseFields(fields));
