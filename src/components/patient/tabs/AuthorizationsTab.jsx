/**
 * AuthorizationsTab — thin wrapper around the shared AuthorizationWorkspace.
 *
 * The drawer view and the module-page right panel MUST show the same data
 * and stay in sync. Both consume AuthorizationWorkspace (variant="drawer"
 * here, variant="panel" in StagePanel). Writes call triggerDataRefresh()
 * to re-sync the other surface automatically.
 */

import AuthorizationWorkspace from '../../modules/shared/AuthorizationWorkspace.jsx';

export default function AuthorizationsTab({ referral, readOnly = false }) {
  const patient = referral?.patient ? { id: referral.patient.id || referral.patient_id, dob: referral.patient.dob }
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
