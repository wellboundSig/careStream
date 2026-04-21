/**
 * Materialize a virtual insurance entry into a real PatientInsurances row
 * before writing anything that needs a linked-record id.
 *
 * A "virtual" insurance is one synthesized from `Patients.insurance_plans`
 * JSON, with an `_id` prefixed `demo:<patientId>:<planName>` and the flag
 * `_virtual: true`. Airtable's `multipleRecordLinks` fields require real
 * record ids, so any write that references the insurance id (e.g. a new
 * `EligibilityVerifications` row or an `Authorizations.payer_insurance_id`)
 * must first get a real row id.
 *
 * This helper:
 *   1. Returns the existing Airtable record id when the insurance is already real.
 *   2. For virtual insurances, creates a real PatientInsurances row and
 *      returns its record id.
 *   3. Guards against a missing patient Airtable record id — those come from
 *      `patient._id` in the drawer/panel state (business `id` on Patients
 *      is `pat_...` and cannot be written to a link field).
 */

import { createPatientInsurance } from './patientInsurances.js';

export async function ensureRealInsurance(insurance, { patientRecordId }) {
  if (!insurance) throw new Error('ensureRealInsurance: insurance required');
  if (!patientRecordId) throw new Error('ensureRealInsurance: patientRecordId (Airtable rec...) required');

  // Already real — Airtable record ids start with "rec".
  if (!insurance._virtual && /^rec[A-Za-z0-9]+$/.test(insurance._id || '')) {
    return insurance._id;
  }

  const fields = {
    patient_id: patientRecordId, // _linkHelpers wraps in array at the API boundary
    payer_display_name: insurance.payer_display_name || 'Unnamed',
    insurance_category: insurance.insurance_category || 'unknown',
    order_rank: insurance.order_rank || 'unknown',
    entered_from: insurance.entered_from || 'demographics',
    ...(insurance.member_id ? { member_id: insurance.member_id } : {}),
    ...(insurance.plan_name ? { plan_name: insurance.plan_name } : {}),
    is_active_raw: insurance.is_active_raw !== false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const created = await createPatientInsurance(fields);
  return created.id; // Airtable record id
}
