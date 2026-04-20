/**
 * EligibilityTab — thin wrapper around the shared EligibilityWorkspace.
 *
 * The drawer view and the module-page right panel MUST show the same data
 * and stay in sync. To enforce that, both consume the same
 * EligibilityWorkspace component (with `variant="drawer"` here and
 * `variant="panel"` in StagePanel). Any write in either surface calls
 * `triggerDataRefresh()`, and both surfaces re-fetch automatically.
 */

import EligibilityWorkspace from '../../modules/shared/EligibilityWorkspace.jsx';

export default function EligibilityTab({ patient, referral, readOnly = false }) {
  return (
    <EligibilityWorkspace
      patient={patient}
      referral={referral}
      readOnly={readOnly}
      variant="drawer"
    />
  );
}
