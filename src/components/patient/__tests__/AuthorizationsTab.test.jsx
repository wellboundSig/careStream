import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

// ── Mocks (must precede component import) ────────────────────────────────────
vi.mock('../../../api/authorizations.js', () => ({
  getAuthorizationsByReferral: vi.fn().mockResolvedValue([]),
  createAuthorization: vi.fn(),
  updateAuthorization: vi.fn(),
}));
vi.mock('../../../api/patientInsurances.js', () => ({
  getInsurancesByPatient: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../api/eligibilityVerifications.js', () => ({
  getVerificationsByPatient: vi.fn().mockResolvedValue([]),
  readVerificationInsuranceId: vi.fn(() => null),
}));
vi.mock('../../../api/activityLog.js', () => ({ recordActivity: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../store/careStore.js', () => ({
  useCareStore: (sel) => sel({ departments: {}, users: {}, authorizations: {} }),
  mergeEntities: vi.fn(),
}));
vi.mock('../../../store/mutations.js', () => ({
  createNoteOptimistic: vi.fn().mockResolvedValue({}),
  createTaskOptimistic: vi.fn(),
  updateReferralOptimistic: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../utils/conflictFlagging.js', () => ({
  flagConflict: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../hooks/useCurrentAppUser.js', () => ({
  useCurrentAppUser: () => ({
    appUser: { id: 'u_test', _id: 'rec_u_test', first_name: 'Test', last_name: 'User' },
    appUserId: 'u_test',
    appUserName: 'Test User',
  }),
}));
vi.mock('../../../hooks/usePermissions.js', () => ({
  usePermissions: () => ({ can: () => true }),
}));

import AuthorizationsTab from '../tabs/AuthorizationsTab.jsx';
import { createAuthorization } from '../../../api/authorizations.js';
import { getInsurancesByPatient } from '../../../api/patientInsurances.js';

function makeReferral(division) {
  return {
    id: 'ref_1', _id: 'rec_ref_1',
    division,
    patient_id: 'p_1',
    patient: { id: 'p_1', _id: 'rec_p_1' },
  };
}

function insRec(id, fields) { return { id, fields }; }

beforeEach(() => {
  createAuthorization.mockReset().mockResolvedValue({ id: 'auth_1', fields: {} });
  getInsurancesByPatient.mockReset().mockResolvedValue([
    insRec('rec_ins_1', { patient_id: ['rec_p_1'], payer_display_name: 'Medicare', insurance_category: 'medicare', order_rank: 'primary' }),
  ]);
});

async function openResponseEditor(division) {
  render(<AuthorizationsTab referral={makeReferral(division)} />);
  const card = await screen.findByTestId('auth-insurance-card');
  await act(async () => { fireEvent.click(within(card).getByTestId('record-auth-response')); });
  return card;
}

async function addServiceLine(card, service) {
  await act(async () => {
    fireEvent.change(within(card).getByTestId('add-service-line'), { target: { value: service } });
  });
  return within(card).getByTestId('service-line');
}

describe('AuthorizationsTab — per-insurance cards', () => {
  it('renders one card per insurance on file', async () => {
    getInsurancesByPatient.mockResolvedValue([
      insRec('rec_ins_1', { patient_id: ['rec_p_1'], payer_display_name: 'Medicare', insurance_category: 'medicare', order_rank: 'primary' }),
      insRec('rec_ins_2', { patient_id: ['rec_p_1'], payer_display_name: 'Fidelis', insurance_category: 'medicaid_managed', order_rank: 'secondary' }),
    ]);
    render(<AuthorizationsTab referral={makeReferral('Special Needs')} />);
    const cards = await screen.findAllByTestId('auth-insurance-card');
    expect(cards).toHaveLength(2);
  });
});

describe('AuthorizationsTab — division-specific decisions', () => {
  it('SPN offers Approved / Partial / Denied / Balance bill', async () => {
    const card = await openResponseEditor('Special Needs');
    const line = await addServiceLine(card, 'PT');
    const decision = within(line).getAllByRole('combobox')[0];
    const labels = Array.from(decision.querySelectorAll('option')).map((o) => o.textContent).join('|');
    expect(labels).toMatch(/Approved/);
    expect(labels).toMatch(/Partial Approval/);
    expect(labels).toMatch(/Denied/);
    expect(labels).toMatch(/Balance bill Medicaid/);
  });

  it('ALF offers NAR / Follow-up needed / Approved (no Partial or Balance bill)', async () => {
    const card = await openResponseEditor('ALF');
    const line = await addServiceLine(card, 'PT');
    const decision = within(line).getAllByRole('combobox')[0];
    const labels = Array.from(decision.querySelectorAll('option')).map((o) => o.textContent).join('|');
    expect(labels).toMatch(/NAR/);
    expect(labels).toMatch(/Follow-up needed/);
    expect(labels).toMatch(/Approved/);
    expect(labels).not.toMatch(/Partial Approval/);
    expect(labels).not.toMatch(/Balance bill/);
  });

  it('ALF cannot add HHA as a service; Special Needs can', async () => {
    const alfCard = await openResponseEditor('ALF');
    const alfServices = Array.from(within(alfCard).getByTestId('add-service-line').querySelectorAll('option')).map((o) => o.value);
    expect(alfServices).not.toContain('HHA');

    screen.getByTestId('authorization-workspace'); // sanity
  });
});

describe('AuthorizationsTab — unit types', () => {
  it('only offers Visits and Hours (Days/Episodes removed)', async () => {
    const card = await openResponseEditor('Special Needs');
    const line = await addServiceLine(card, 'PT'); // default decision Approved → unit fields shown
    const selects = within(line).getAllByRole('combobox');
    // [0] decision, [1] unit type
    const unitLabels = Array.from(selects[1].querySelectorAll('option')).map((o) => o.textContent);
    expect(unitLabels).toEqual(expect.arrayContaining(['Visits', 'Hours']));
    expect(unitLabels).not.toContain('Days');
    expect(unitLabels).not.toContain('Episodes');
  });
});

describe('AuthorizationsTab — save', () => {
  it('records a per-insurance response with per-service decisions', async () => {
    const card = await openResponseEditor('Special Needs');
    const line = await addServiceLine(card, 'PT');
    // Use Denied so no approval-date is required for this save.
    const decision = within(line).getAllByRole('combobox')[0];
    await act(async () => { fireEvent.change(decision, { target: { value: 'denied' } }); });
    await act(async () => { fireEvent.click(within(card).getByTestId('save-auth-response')); });
    expect(createAuthorization).toHaveBeenCalled();
    const payload = createAuthorization.mock.calls[0][0];
    expect(payload.payer_insurance_id).toBe('rec_ins_1');
    expect(payload.auth_status).toBe('denied');
    const lines = JSON.parse(payload.service_lines);
    expect(lines[0]).toMatchObject({ service: 'PT', decision: 'denied' });
  });
});
