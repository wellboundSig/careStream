/**
 * F2F / MD Orders Document Review Checklist
 *
 * Cursory review used by the F2F team before pushing to Clinical RN review.
 * Persisted to the `CursoryReview` table in Airtable — one row per referral.
 *
 * The `dbField` on each item is the Airtable column name. The separation
 * between UI keys and DB column names is intentional: UI keys are short and
 * readable, DB columns are self-documenting for audit. All read/write code
 * goes through `uiToDbFields()` / `dbToUiFields()` in src/api/cursoryReviews.js
 * so the mapping lives in exactly one place.
 */

export const F2F_REVIEW_CHECKLIST = [
  { key: 'f2f_doc_present',   dbField: 'face_to_face_document_present',   label: 'Face-to-face document present',              required: true },
  { key: 'md_orders_present', dbField: 'physician_certification_present', label: 'MD orders / physician certification present', required: true },
  { key: 'patient_name_match',dbField: 'patient_name_matches_referral',   label: 'Patient name matches referral',               required: true },
  { key: 'dates_valid',       dbField: 'dates_valid_within_90_days',      label: 'Dates are valid and within 90 days',          required: true },
  { key: 'physician_signed',  dbField: 'physician_signature_present',     label: 'Physician signature present',                 required: true },
  { key: 'diagnosis_listed',  dbField: 'diagnosis_icd_codes_listed',      label: 'Diagnosis / ICD codes listed',                required: true },
  { key: 'homebound_stated',  dbField: 'homebound_status_documented',     label: 'Homebound status documented',                 required: false },
  { key: 'services_specified',dbField: 'services_disciplines_specified',  label: 'Services / disciplines specified',            required: false },
];

export const F2F_REQUIRED_ITEMS = F2F_REVIEW_CHECKLIST.filter((i) => i.required);

/**
 * Required-items only. Drives the X/Y progress label, the "*" required markers
 * in the F2F tab, and the "Push to Clinical RN" gate in the module panel —
 * i.e. the minimum bar to advance work. NOT the same as "fully complete".
 */
export function isF2FChecklistComplete(checked) {
  return F2F_REQUIRED_ITEMS.every((item) => checked[item.key]);
}

/**
 * Every cursory checkbox is checked (including the optional items). Retained
 * for any caller that wants the strict "all boxes" notion; the F2F tab green
 * check uses the required-only rule via `isF2FTabComplete` below.
 */
export function isF2FCursoryFullyChecked(checked) {
  return F2F_REVIEW_CHECKLIST.every((item) => checked[item.key]);
}

/**
 * SINGLE SOURCE OF TRUTH for the F2F tab's green "complete" check.
 *
 * The green check appears when, and only when, ALL THREE hold:
 *   1. At least one F2F or MD Orders document is uploaded (either one counts).
 *   2. A date of visit is logged on the referral (`f2f_date`).
 *   3. The MANDATORY cursory-review items are checked (the two optional items —
 *      Homebound status, Services/disciplines — and the separate
 *      Hospitalization Review widget are NOT required).
 *
 * This is a pure rule over current data, so it applies uniformly to every
 * existing and future referral and updates in realtime as files / date /
 * checklist change in the store.
 *
 * @param {{ hasF2FFile?: boolean, hasF2FDate?: boolean, cursoryChecked?: object }} input
 * @returns {boolean}
 */
export function isF2FTabComplete({ hasF2FFile, hasF2FDate, cursoryChecked } = {}) {
  return !!hasF2FFile && !!hasF2FDate && isF2FChecklistComplete(cursoryChecked || {});
}

// Convenient lookup tables derived from the checklist.
export const CURSORY_UI_TO_DB = Object.fromEntries(F2F_REVIEW_CHECKLIST.map((i) => [i.key, i.dbField]));
export const CURSORY_DB_TO_UI = Object.fromEntries(F2F_REVIEW_CHECKLIST.map((i) => [i.dbField, i.key]));
