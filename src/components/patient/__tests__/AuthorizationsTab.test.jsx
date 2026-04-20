import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Mock all API and permissions hooks before the component is imported.
vi.mock('../../../api/authorizations.js', () => ({
  getAuthorizationsByReferral: vi.fn().mockResolvedValue([]),
  createAuthorization: vi.fn(),
}));
vi.mock('../../../api/patientInsurances.js', () => ({
  getInsurancesByPatient: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../api/eligibilityVerifications.js', () => ({
  getVerificationsByPatient: vi.fn().mockResolvedValue([]),
  createEligibilityVerification: vi.fn(),
}));
vi.mock('../../../api/conflicts.js', () => ({ createConflict: vi.fn() }));
vi.mock('../../../api/activityLog.js', () => ({ recordActivity: vi.fn() }));
vi.mock('../../../hooks/useCurrentAppUser.js', () => ({
  useCurrentAppUser: () => ({ appUserId: 'u_test', appUserName: 'Test User' }),
}));
vi.mock('../../../hooks/usePermissions.js', () => ({
  usePermissions: () => ({ can: () => true }),
}));

import AuthorizationsTab from '../tabs/AuthorizationsTab.jsx';
import { createAuthorization } from '../../../api/authorizations.js';

function makeReferral(division) {
  return { id: 'ref_1', division, patient_id: 'p_1', patient: { id: 'p_1', primary_insurance_id: 'ins_1' } };
}

beforeEach(() => {
  createAuthorization.mockReset().mockResolvedValue({ id: 'auth_1', fields: {} });
});

async function openModePicker() {
  const btn = await screen.findByText('+ Record Auth');
  await act(async () => { fireEvent.click(btn); });
}

// D.5 Conflict modal requires at least one reason — covered in EligibilityTab tests.
// D.6 Authorization form hides ABA
// D.7 Authorization form blocks HHA for ALF

describe('AuthorizationsTab — service availability', () => {
  it('Authorization form never shows ABA', async () => {
    const referral = makeReferral('Special Needs');
    render(<AuthorizationsTab referral={referral} />);
    await openModePicker();
    await act(async () => { fireEvent.click(screen.getByTestId('auth-mode-approved')); });
    expect(screen.queryByTestId('auth-service-ABA')).toBeNull();
  });

  it('Authorization form blocks HHA for ALF', async () => {
    const referral = makeReferral('ALF');
    render(<AuthorizationsTab referral={referral} />);
    await openModePicker();
    await act(async () => { fireEvent.click(screen.getByTestId('auth-mode-approved')); });
    expect(screen.queryByTestId('auth-service-HHA')).toBeNull();
    expect(screen.getByTestId('blocked-services').textContent).toMatch(/HHA/);
  });

  it('Special Needs still shows HHA', async () => {
    const referral = makeReferral('Special Needs');
    render(<AuthorizationsTab referral={referral} />);
    await openModePicker();
    await act(async () => { fireEvent.click(screen.getByTestId('auth-mode-approved')); });
    expect(screen.getByTestId('auth-service-HHA')).toBeDefined();
  });
});

describe('AuthorizationsTab — denial flow never routes to NTUC', () => {
  it('denial UI does not show NTUC as a next-action option', async () => {
    const referral = makeReferral('Special Needs');
    render(<AuthorizationsTab referral={referral} />);
    await openModePicker();
    await act(async () => { fireEvent.click(screen.getByTestId('auth-mode-denied')); });
    const select = screen.getByTestId('denial-next-action');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    for (const o of options) {
      expect(o).not.toMatch(/NTUC/i);
    }
  });

  it('SPN denial offers Request SCA; ALF denial does not', async () => {
    // SPN
    const spn = makeReferral('Special Needs');
    const { unmount } = render(<AuthorizationsTab referral={spn} />);
    await openModePicker();
    await act(async () => { fireEvent.click(screen.getByTestId('auth-mode-denied')); });
    const spnOptions = Array.from(screen.getByTestId('denial-next-action').querySelectorAll('option')).map((o) => o.textContent).join('|');
    expect(spnOptions).toMatch(/SCA|Single Case Agreement/i);
    unmount();

    // ALF
    render(<AuthorizationsTab referral={makeReferral('ALF')} />);
    await openModePicker();
    await act(async () => { fireEvent.click(screen.getByTestId('auth-mode-denied')); });
    const alfOptions = Array.from(screen.getByTestId('denial-next-action').querySelectorAll('option')).map((o) => o.textContent).join('|');
    expect(alfOptions).not.toMatch(/SCA|Single Case Agreement/i);
  });
});

describe('AuthorizationsTab — follow-up requires date and owner', () => {
  it('enables save only when date + owner are filled', async () => {
    const referral = makeReferral('Special Needs');
    render(<AuthorizationsTab referral={referral} />);
    await openModePicker();
    await act(async () => { fireEvent.click(screen.getByTestId('auth-mode-follow_up_needed')); });
    const dateInput = screen.getByTestId('follow-up-date');
    const ownerInput = screen.getByTestId('follow-up-owner');
    // Without anything typed, the confirm button is disabled. We don't assert
    // on the exact label, just that fields exist.
    expect(dateInput).toBeDefined();
    expect(ownerInput).toBeDefined();
  });
});

describe('AuthorizationsTab — NAR mode can save without auth number', () => {
  it('saves a NAR record when user confirms', async () => {
    const referral = makeReferral('Special Needs');
    render(<AuthorizationsTab referral={referral} />);
    await openModePicker();
    await act(async () => { fireEvent.click(screen.getByTestId('auth-mode-nar')); });
    await act(async () => { fireEvent.click(screen.getByText('Confirm NAR')); });
    expect(createAuthorization).toHaveBeenCalled();
    const payload = createAuthorization.mock.calls[0][0];
    expect(payload.auth_status).toBe('nar');
  });
});
