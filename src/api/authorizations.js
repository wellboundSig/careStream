/**
 * Authorizations API.
 *
 * Linked-record fields (patient_id, payer_insurance_id, follow_up_owner_user_id,
 * decided_by_user_id) are normalised at this API boundary.
 *
 * NOTE: the legacy `services_authorized` column in Airtable still lists ABA
 * as a singleSelect option for backwards compatibility with old data. The
 * code never writes ABA (enforced by serviceAvailabilityPolicies). ABA
 * should be removed from the Airtable option list when convenient.
 */

import airtable from './airtable.js';
import { toLinks } from './_linkHelpers.js';

const TABLE = 'Authorizations';

const LINK_FIELDS = ['patient_id', 'payer_insurance_id', 'follow_up_owner_user_id', 'decided_by_user_id'];

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

export const getAuthorizationsByReferral = (referralId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `{referral_id} = "${referralId}"` });

export const getAuthorizationsByPatient = (patientId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `FIND("${patientId}", ARRAYJOIN({patient_id}))` });

export const getAuthorizationsByInsurance = (insuranceId) =>
  airtable.fetchAll(TABLE, { filterByFormula: `FIND("${insuranceId}", ARRAYJOIN({payer_insurance_id}))` });

export const createAuthorization = (fields) => airtable.create(TABLE, normaliseFields(fields));
export const updateAuthorization = (id, fields) => airtable.update(TABLE, id, normaliseFields(fields));
