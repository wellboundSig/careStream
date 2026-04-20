/**
 * Cross-surface sync test.
 *
 * Verifies that when the Eligibility drawer tab and the Eligibility module
 * panel are mounted at the same time (the real-world scenario when an
 * eligibility specialist has the right-side panel open on the module page
 * AND the patient drawer open), both surfaces re-fetch data after any
 * save that calls triggerDataRefresh().
 *
 * This is the test that guards against drift between the two views.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../../../../api/patientInsurances.js', () => ({
  getInsurancesByPatient: vi.fn(),
}));
vi.mock('../../../../api/eligibilityVerifications.js', () => ({
  getVerificationsByPatient: vi.fn().mockResolvedValue([]),
  createEligibilityVerification: vi.fn(),
}));
vi.mock('../../../../api/insuranceChecks.js', () => ({
  getChecksByPatient: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../../api/authorizations.js', () => ({
  getAuthorizationsByReferral: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../../api/disenrollmentFlags.js', () => ({
  getDisenrollmentFlagsByPatient: vi.fn().mockResolvedValue([]),
  createDisenrollmentFlag: vi.fn(),
}));
vi.mock('../../../../api/conflicts.js', () => ({ createConflict: vi.fn() }));
vi.mock('../../../../api/activityLog.js', () => ({ recordActivity: vi.fn() }));
vi.mock('../../../../hooks/useCurrentAppUser.js', () => ({
  useCurrentAppUser: () => ({ appUserId: 'u_sync', appUserName: 'Sync User' }),
}));
vi.mock('../../../../hooks/useLookups.js', () => ({
  useLookups: () => ({ resolveUser: (x) => x || '—' }),
}));
vi.mock('../../../../hooks/usePermissions.js', () => ({
  usePermissions: () => ({ can: () => true }),
}));

import EligibilityWorkspace from '../EligibilityWorkspace.jsx';
import { triggerDataRefresh } from '../../../../hooks/useRefreshTrigger.js';
import { getInsurancesByPatient } from '../../../../api/patientInsurances.js';

const patient = { id: 'p_sync', dob: '1950-01-01' };
const referral = { id: 'ref_sync', division: 'Special Needs', patient_id: 'p_sync' };

beforeEach(() => {
  getInsurancesByPatient.mockReset().mockResolvedValue([
    { id: 'i_1', fields: { patient_id: 'p_sync', payer_display_name: 'Medicare', insurance_category: 'medicare', order_rank: 'primary' } },
  ]);
});

describe('workspace sync — panel + drawer both refetch on triggerDataRefresh', () => {
  it('both workspaces re-fetch when triggerDataRefresh() fires', async () => {
    // Render two instances: one panel, one drawer. Simulating both surfaces
    // mounted simultaneously.
    await act(async () => {
      render(<EligibilityWorkspace patient={patient} referral={referral} variant="panel" />);
      render(<EligibilityWorkspace patient={patient} referral={referral} variant="drawer" />);
    });

    // Each mount fetches once → 2 calls total initially.
    await act(async () => { await Promise.resolve(); });
    const initial = getInsurancesByPatient.mock.calls.length;
    expect(initial).toBeGreaterThanOrEqual(2);

    // Fire a refresh — every mounted workspace should re-fetch.
    await act(async () => { triggerDataRefresh(); });
    await act(async () => { await Promise.resolve(); });

    const after = getInsurancesByPatient.mock.calls.length;
    expect(after).toBeGreaterThanOrEqual(initial + 2);
  });
});
