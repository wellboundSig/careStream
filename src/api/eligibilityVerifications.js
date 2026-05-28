/**
 * EligibilityVerifications API — verification events per insurance.
 *
 * Linked-record fields in Airtable require array values. We normalise at
 * this boundary so callers can pass a plain string id and be correct.
 *
 * ── insurance_id → patient_insurance_id repair (2026-05-27) ────────────────
 * Airtable's legacy `insurance_id` link on this table is wired to the
 * `PatientInsurancePlans` table (`tblBGbuHgt54oaDbS`), but every caller
 * passes ids from the canonical `PatientInsurances` table
 * (`tblg7s0UuWsN99367`). Airtable rejected those writes with:
 *   Record ID rec… belongs to table tblg7s0UuWsN99367,
 *   but the field links to table tblBGbuHgt54oaDbS
 * We can't relink an existing field via the Meta API, so this module:
 *   1. Accepts the historical `insurance_id` arg from callers
 *   2. Rewrites it to the new `patient_insurance_id` link field (correctly
 *      wired to PatientInsurances by the schema-apply script)
 *   3. Strips the now-stale `insurance_id` from outgoing payloads so the
 *      original Airtable error stops firing.
 * Readers prefer `patient_insurance_id`, falling back to `insurance_id`
 * for back-compat with any rows already present in the legacy field.
 */

import airtable from './airtable.js';
import { toLinks, readLink } from './_linkHelpers.js';

const TABLE = 'EligibilityVerifications';

const LEGACY_INSURANCE_FIELD = 'insurance_id';
const CANONICAL_INSURANCE_FIELD = 'patient_insurance_id';

// patient_id, patient_insurance_id, and verified_by_user_id are
// multipleRecordLinks. We normalise array-vs-string at the boundary and
// rewrite the legacy `insurance_id` arg into the new canonical field.
const LINK_FIELDS = ['patient_id', CANONICAL_INSURANCE_FIELD, 'verified_by_user_id'];

function normaliseFields(fields) {
  if (!fields) return fields;
  const out = { ...fields };

  if (LEGACY_INSURANCE_FIELD in out && !(CANONICAL_INSURANCE_FIELD in out)) {
    out[CANONICAL_INSURANCE_FIELD] = out[LEGACY_INSURANCE_FIELD];
  }
  delete out[LEGACY_INSURANCE_FIELD];

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
    // OR() lets us match new-canonical and legacy rows in one pass.
    filterByFormula:
      `OR(FIND("${insuranceId}", ARRAYJOIN({${CANONICAL_INSURANCE_FIELD}})),` +
      ` FIND("${insuranceId}", ARRAYJOIN({${LEGACY_INSURANCE_FIELD}})))`,
    sort: [{ field: 'verification_date_time', direction: 'desc' }],
  });

export const createEligibilityVerification = (fields) =>
  airtable.create(TABLE, normaliseFields(fields));
export const updateEligibilityVerification = (id, fields) =>
  airtable.update(TABLE, id, normaliseFields(fields));

/**
 * Returns the linked PatientInsurance id for a verification row, preferring
 * the canonical link and falling back to the legacy one. Callers should use
 * this rather than reading the fields directly so the migration is
 * transparent at every read site.
 */
export function readVerificationInsuranceId(verification) {
  if (!verification) return null;
  return (
    readLink(verification[CANONICAL_INSURANCE_FIELD]) ||
    readLink(verification[LEGACY_INSURANCE_FIELD]) ||
    null
  );
}
