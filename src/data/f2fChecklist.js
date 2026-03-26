/**
 * F2F / MD Orders Document Review Checklist
 *
 * PLACEHOLDER — the final checklist must be provided by management.
 * This is a cursory review checklist used by the F2F team before sending
 * documentation to the Clinical RN for full review.
 *
 * The checklist is UI-only (not persisted to Airtable).
 * It gates the "Confirm → Clinical Intake RN Review" button.
 */

export const F2F_REVIEW_CHECKLIST = [
  { key: 'f2f_doc_present',   label: 'Face-to-face document present',           required: true },
  { key: 'md_orders_present', label: 'MD orders / physician certification present', required: true },
  { key: 'patient_name_match',label: 'Patient name matches referral',            required: true },
  { key: 'dates_valid',       label: 'Dates are valid and within 90 days',       required: true },
  { key: 'physician_signed',  label: 'Physician signature present',              required: true },
  { key: 'diagnosis_listed',  label: 'Diagnosis / ICD codes listed',             required: true },
  { key: 'homebound_stated',  label: 'Homebound status documented',              required: false },
  { key: 'services_specified',label: 'Services / disciplines specified',          required: false },
];

export const F2F_REQUIRED_ITEMS = F2F_REVIEW_CHECKLIST.filter((i) => i.required);

export function isF2FChecklistComplete(checked) {
  return F2F_REQUIRED_ITEMS.every((item) => checked[item.key]);
}
