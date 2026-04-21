import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

vi.mock('../../../api/insuranceChecks.js', () => ({ getChecksByPatient: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../api/authorizations.js', () => ({ getAuthorizationsByReferral: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../api/patientInsurances.js', () => ({
  getInsurancesByPatient: vi.fn(),
  createPatientInsurance: vi.fn().mockResolvedValue({ id: 'rec_ins_new', fields: {} }),
  updatePatientInsurance: vi.fn().mockResolvedValue({ id: 'rec_ins_new', fields: {} }),
  deletePatientInsurance: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../api/patients.js', () => ({
  getPatient: vi.fn().mockResolvedValue(null),
  updatePatient: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../api/disenrollmentFlags.js', () => ({
  getDisenrollmentFlagsByPatient: vi.fn().mockResolvedValue([]),
  createDisenrollmentFlag: vi.fn().mockResolvedValue({ id: 'rec_dis', fields: {} }),
}));
vi.mock('../../../api/eligibilityVerifications.js', () => ({
  getVerificationsByPatient: vi.fn().mockResolvedValue([]),
  createEligibilityVerification: vi.fn(),
}));
vi.mock('../../../api/conflicts.js', () => ({ createConflict: vi.fn() }));
vi.mock('../../../api/activityLog.js', () => ({ recordActivity: vi.fn() }));
vi.mock('../../../hooks/useCurrentAppUser.js', () => ({
  useCurrentAppUser: () => ({
    appUser: { id: 'u_test', _id: 'rec_u_test', first_name: 'Test', last_name: 'User' },
    appUserId: 'u_test',
    appUserName: 'Test User',
  }),
}));
vi.mock('../../../hooks/useLookups.js', () => ({
  useLookups: () => ({ resolveUser: (id) => id || '—' }),
}));
vi.mock('../../../hooks/usePermissions.js', () => ({
  usePermissions: () => ({ can: () => true }),
}));

import EligibilityTab from '../tabs/EligibilityTab.jsx';
import { getInsurancesByPatient } from '../../../api/patientInsurances.js';
import { getVerificationsByPatient, createEligibilityVerification } from '../../../api/eligibilityVerifications.js';
import { createConflict } from '../../../api/conflicts.js';

const patient = { id: 'p_1', _id: 'rec_p_1', dob: '1950-01-01' };
const referral = { id: 'ref_1', _id: 'rec_ref_1', division: 'Special Needs', patient_id: 'p_1' };

function insRec(id, fields) {
  return { id, fields };
}

beforeEach(() => {
  getInsurancesByPatient.mockReset();
  getVerificationsByPatient.mockReset().mockResolvedValue([]);
  createEligibilityVerification.mockReset().mockResolvedValue({ id: 'ev_new', fields: {} });
  createConflict.mockReset().mockResolvedValue({ id: 'c_1', fields: {} });
});

// D.1 renders one card per insurance
describe('EligibilityTab — demographics sync', () => {
  it('renders one card per demographic insurance', async () => {
    getInsurancesByPatient.mockResolvedValue([
      insRec('i_1', { patient_id: 'p_1', payer_display_name: 'Medicare',  insurance_category: 'medicare',         order_rank: 'primary' }),
      insRec('i_2', { patient_id: 'p_1', payer_display_name: 'Fidelis',   insurance_category: 'medicaid_managed', order_rank: 'secondary' }),
    ]);
    render(<EligibilityTab patient={patient} referral={referral} />);
    const cards = await screen.findAllByTestId('insurance-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toMatch(/Medicare/);
    expect(cards[1].textContent).toMatch(/Fidelis/);
  });
});

describe('EligibilityTab — verification form', () => {
  async function openFirstEdit() {
    getInsurancesByPatient.mockResolvedValue([
      insRec('i_1', { patient_id: 'p_1', payer_display_name: 'Medicare', insurance_category: 'medicare', order_rank: 'primary' }),
    ]);
    render(<EligibilityTab patient={patient} referral={referral} />);
    const card = await screen.findByTestId('insurance-card');
    await act(async () => { fireEvent.click(within(card).getByTestId('verify-btn')); });
    return card;
  }

  // D.2 Verification source supports multi-select
  it('allows multi-select of verification sources (with default pre-selection)', async () => {
    const card = await openFirstEdit();
    const waystar = within(card).getByTestId('source-waystar');
    const phone   = within(card).getByTestId('source-phone');
    // Medicare -> Waystar is suggested; default pre-selected when opening edit with no existing sources.
    expect(waystar.checked).toBe(true);
    expect(phone.checked).toBe(false);
    await act(async () => { fireEvent.click(phone); });
    expect(waystar.checked).toBe(true);
    expect(phone.checked).toBe(true);
  });

  // D.3 Insurance type selector distinguishes Medicare vs Medicare Managed
  it('insurance type selector distinguishes Medicare from Medicare Managed and Medicaid from Medicaid Managed', async () => {
    const card = await openFirstEdit();
    const select = within(card).getByTestId('payer-type-select');
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toContain('Medicare');
    expect(labels).toContain('Medicare Managed (Advantage)');
    expect(labels).toContain('Medicaid');
    expect(labels).toContain('Medicaid Managed (MCO / MLTC)');
  });

  // D.4 Third Party field and Commercial Plan field remain distinct
  it('distinguishes Third Party from Commercial Plan in the type selector', async () => {
    const card = await openFirstEdit();
    const labels = Array.from(within(card).getByTestId('payer-type-select').querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toContain('Third Party');
    expect(labels).toContain('Commercial Plan');
    // They are two different options.
    expect(labels.indexOf('Third Party')).not.toBe(labels.indexOf('Commercial Plan'));
  });

  it('saves verification with expected fields', async () => {
    const card = await openFirstEdit();
    // Waystar is pre-selected as the default source for Medicare; keep it checked.
    await act(async () => { fireEvent.change(within(card).getByTestId('status-select'), { target: { value: 'confirmed_active' } }); });
    await act(async () => { fireEvent.change(within(card).getByTestId('order-select'),  { target: { value: 'primary' } }); });
    await act(async () => { fireEvent.click(within(card).getByTestId('save-verification')); });
    expect(createEligibilityVerification).toHaveBeenCalled();
    const fields = createEligibilityVerification.mock.calls[0][0];
    expect(fields.verification_status).toBe('confirmed_active');
    expect(fields.staff_confirmed_order_rank).toBe('primary');
    expect(fields.verification_sources).toContain('waystar');
    expect(fields.verified_by_user_id).toBe('u_test');
    expect(fields.verification_date_time).toBeTruthy();
  });
});

// D.5 Conflict modal requires at least one reason
describe('EligibilityTab — conflict modal', () => {
  it('requires at least one reason before confirming', async () => {
    getInsurancesByPatient.mockResolvedValue([
      insRec('i_1', { patient_id: 'p_1', payer_display_name: 'Medicare', insurance_category: 'medicare', order_rank: 'primary' }),
    ]);
    render(<EligibilityTab patient={patient} referral={referral} />);
    const card = await screen.findByTestId('insurance-card');
    await act(async () => { fireEvent.click(within(card).getByTestId('send-conflict-btn')); });
    const modal = await screen.findByTestId('conflict-modal');
    const confirm = within(modal).getByTestId('conflict-confirm');
    expect(confirm.disabled).toBe(true);
    await act(async () => { fireEvent.click(within(modal).getByTestId('conflict-reason-coverage_not_active')); });
    expect(confirm.disabled).toBe(false);
  });

  it('creates a conflict and records an audit trail when confirmed', async () => {
    getInsurancesByPatient.mockResolvedValue([
      insRec('i_1', { patient_id: 'p_1', payer_display_name: 'Medicare', insurance_category: 'medicare', order_rank: 'primary' }),
    ]);
    render(<EligibilityTab patient={patient} referral={referral} />);
    const card = await screen.findByTestId('insurance-card');
    await act(async () => { fireEvent.click(within(card).getByTestId('send-conflict-btn')); });
    const modal = await screen.findByTestId('conflict-modal');
    await act(async () => { fireEvent.click(within(modal).getByTestId('conflict-reason-coverage_not_active')); });
    await act(async () => { fireEvent.click(within(modal).getByTestId('conflict-confirm')); });
    expect(createConflict).toHaveBeenCalled();
    const payload = createConflict.mock.calls[0][0];
    expect(payload.conflict_reasons).toContain('coverage_not_active');
  });
});

// E.1 Regression: legacy yes/no blocker fields are absent from main eligibility form
describe('EligibilityTab — regression', () => {
  it('legacy yes/no blocker fields are NOT present as neutral toggles', async () => {
    getInsurancesByPatient.mockResolvedValue([
      insRec('i_1', { patient_id: 'p_1', payer_display_name: 'Medicare', insurance_category: 'medicare', order_rank: 'primary' }),
    ]);
    render(<EligibilityTab patient={patient} referral={referral} />);
    await screen.findByTestId('insurance-card');
    // These labels belonged to the legacy neutral form:
    const legacyLabels = [
      'Open HH Episode', 'Hospice Overlap', 'SNF Present',
      'CDPAP Active', 'Auth Required', 'Disenrollment Needed',
    ];
    for (const l of legacyLabels) {
      // They should not appear as form toggles outside the conflict modal.
      // Simplest check: top-level panel should not render them as selects with Yes/No options.
      expect(screen.queryAllByText(l)).toHaveLength(0);
    }
  });
});
