/**
 * AuthorizationsTab — thin wrapper around the shared AuthorizationWorkspace.
 *
 * Important: pass the full patient record (both `id` and `_id`). Airtable
 * link fields need the record id (`_id` / rec...). See
 * INSURANCE_CONSOLIDATION_PLAN.md.
 */

import AuthorizationWorkspace from '../../modules/shared/AuthorizationWorkspace.jsx';

export default function AuthorizationsTab({ referral, readOnly = false }) {
  const patient = referral?.patient
    ? { ...referral.patient, id: referral.patient.id || referral.patient_id }
    : referral?.patient_id ? { id: referral.patient_id } : null;
  return (
    <AuthorizationWorkspace
      patient={patient}
      referral={referral}
      readOnly={readOnly}
      variant="drawer"
    />
  );
}
