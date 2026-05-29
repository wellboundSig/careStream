/**
 * EligibilityVerifications API — verification events per insurance.
 *
 * Every cross-table reference on this table is a plain TEXT column (no
 * Airtable linked-record fields). We store ids as bare strings:
 *   - `patient_id`            → the patient BUSINESS id (pat_…), so the
 *                               FIND() reads below match.
 *   - `patient_insurance_id`  → the PatientInsurances record id (rec…),
 *                               which is how insurance rows are keyed in the
 *                               UI (`ins._id`).
 *   - `verified_by_user_id`   → whatever id the caller supplies.
 *
 * Historically these were treated as `multipleRecordLinks` and wrapped in
 * arrays; the columns are now text, so an array value like `["rec…"]` is
 * rejected by Airtable. `toText` coerces any stray array/string to a clean
 * scalar string at this boundary.
 *
 * ── legacy `insurance_id` → `patient_insurance_id` ─────────────────────────
 * Older callers passed `insurance_id`; we rewrite it to the canonical
 * `patient_insurance_id` and drop the stale field. Readers prefer the
 * canonical field and fall back to the legacy one for old rows.
 */

import airtable from './airtable.js';
import { readLink } from './_linkHelpers.js';

const TABLE = 'EligibilityVerifications';

const LEGACY_INSURANCE_FIELD = 'insurance_id';
const CANONICAL_INSURANCE_FIELD = 'patient_insurance_id';

// All id references are plain text. Coerce array/string → scalar string.
const TEXT_ID_FIELDS = ['patient_id', CANONICAL_INSURANCE_FIELD, 'verified_by_user_id'];

function toText(value) {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const first = value.find((x) => typeof x === 'string' && x.trim());
    return first ? String(first) : undefined;
  }
  const s = String(value).trim();
  return s || undefined;
}

function normaliseFields(fields) {
  if (!fields) return fields;
  const out = { ...fields };

  if (LEGACY_INSURANCE_FIELD in out && !(CANONICAL_INSURANCE_FIELD in out)) {
    out[CANONICAL_INSURANCE_FIELD] = out[LEGACY_INSURANCE_FIELD];
  }
  delete out[LEGACY_INSURANCE_FIELD];

  for (const f of TEXT_ID_FIELDS) {
    if (f in out) {
      const v = toText(out[f]);
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
