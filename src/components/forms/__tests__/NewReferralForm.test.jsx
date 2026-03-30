import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { getLicenceForCounty, getServicesForDivision } from '../NewReferralForm.jsx';

// ── Unit tests for exported helpers (no React rendering needed) ──────────────

describe('getLicenceForCounty', () => {
  it('returns WB for WB-only counties', () => {
    expect(getLicenceForCounty('Kings')).toBe('WB');
    expect(getLicenceForCounty('Nassau')).toBe('WB');
    expect(getLicenceForCounty('Richmond')).toBe('WB');
    expect(getLicenceForCounty('Suffolk')).toBe('WB');
  });

  it('returns WBII for WBII-only counties', () => {
    expect(getLicenceForCounty('Putnam')).toBe('WBII');
    expect(getLicenceForCounty('Westchester')).toBe('WBII');
  });

  it('returns "both" for counties served by both agencies', () => {
    expect(getLicenceForCounty('Bronx')).toBe('both');
    expect(getLicenceForCounty('New York')).toBe('both');
    expect(getLicenceForCounty('Queens')).toBe('both');
  });

  it('returns null for unknown counties', () => {
    expect(getLicenceForCounty('Manhattan')).toBe(null);
    expect(getLicenceForCounty('')).toBe(null);
    expect(getLicenceForCounty(null)).toBe(null);
    expect(getLicenceForCounty(undefined)).toBe(null);
  });
});

describe('getServicesForDivision', () => {
  it('returns services without ABA for ALF', () => {
    const services = getServicesForDivision('ALF');
    expect(services).toContain('SN');
    expect(services).toContain('PT');
    expect(services).toContain('OT');
    expect(services).toContain('ST');
    expect(services).toContain('HHA');
    expect(services).not.toContain('ABA');
  });

  it('returns services with ABA for Special Needs', () => {
    const services = getServicesForDivision('Special Needs');
    expect(services).toContain('SN');
    expect(services).toContain('PT');
    expect(services).toContain('OT');
    expect(services).toContain('ST');
    expect(services).toContain('HHA');
    expect(services).toContain('ABA');
  });

  it('defaults to ALF services for unknown divisions', () => {
    const services = getServicesForDivision('');
    expect(services).not.toContain('ABA');
  });
});

// ── Integration tests (rendered form) ────────────────────────────────────────
// We need to mock all the hooks and APIs the form depends on

const mockCan = vi.fn().mockReturnValue(true);
vi.mock('../../../hooks/usePermissions.js', () => ({
  usePermissions: () => ({ can: mockCan }),
}));

vi.mock('../../../hooks/useCurrentAppUser.js', () => ({
  useCurrentAppUser: () => ({
    appUser: { id: 'usr_test', role_id: 'rol_001' },
    appUserId: 'usr_test',
  }),
}));

vi.mock('../../../hooks/useIsMobile.js', () => ({
  useIsMobile: () => false,
}));

vi.mock('../../../store/careStore.js', () => ({
  useCareStore: (selector) => {
    const state = {
      marketers: { m1: { _id: 'm1', id: 'mkt_1', first_name: 'Jane', last_name: 'Doe', user_id: 'usr_other', division: 'Both' } },
      referralSources: { s1: { _id: 's1', id: 'src_1', name: 'Hospital A' } },
      roles: { r1: { _id: 'r1', id: 'rol_001', name: 'Intake Coordinator' } },
      facilities: { f1: { _id: 'f1', id: 'fac_1', name: 'Sunrise ALF', is_active: 'TRUE' } },
      networkFacilities: { nf1: { _id: 'nf1', id: 'fac_1', name: 'Sunrise ALF', region: 'KINGS' } },
      marketerFacilities: {},
    };
    return selector(state);
  },
  mergeEntities: vi.fn(),
}));

vi.mock('../../../api/patients.js', () => ({
  createPatient: vi.fn().mockResolvedValue({ id: 'rec_pat1', fields: { id: 'pat_test' } }),
}));

vi.mock('../../../api/referrals.js', () => ({
  createReferral: vi.fn().mockResolvedValue({ id: 'rec_ref1', _id: 'rec_ref1', fields: { id: 'ref_test' } }),
  updateReferral: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../api/notes.js', () => ({
  createNote: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../physicians/PhysicianPicker.jsx', () => ({
  default: ({ onChange }) => (
    <button data-testid="physician-picker" onClick={() => onChange({ id: 'phy_1', first_name: 'Dr', last_name: 'Test' })}>
      Pick Physician
    </button>
  ),
}));

// Re-import after mocks
const { default: NewReferralForm } = await import('../NewReferralForm.jsx');
const { createPatient } = await import('../../../api/patients.js');
const { createReferral } = await import('../../../api/referrals.js');

function renderForm(props = {}) {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const result = render(<NewReferralForm onClose={onClose} onSuccess={onSuccess} {...props} />);
  return { ...result, onClose, onSuccess };
}

describe('NewReferralForm — Division selector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(true);
  });

  it('renders division selector at the top with ALF and Special Needs buttons', () => {
    renderForm();
    const alfBtn = screen.getByRole('button', { name: 'ALF' });
    const snBtn = screen.getByRole('button', { name: 'Special Needs' });
    expect(alfBtn).toBeTruthy();
    expect(snBtn).toBeTruthy();
  });

  it('does not show facility selector until ALF is chosen', () => {
    renderForm();
    expect(screen.queryByText('Facility')).toBeFalsy();
    fireEvent.click(screen.getByRole('button', { name: 'ALF' }));
    expect(screen.getByText('Facility')).toBeTruthy();
  });

  it('does not show Adult/Pediatric + County until Special Needs is chosen', () => {
    renderForm();
    expect(screen.queryByText('Age Group')).toBeFalsy();
    expect(screen.queryByText('County')).toBeFalsy();
    fireEvent.click(screen.getByRole('button', { name: 'Special Needs' }));
    expect(screen.getByText('Age Group')).toBeTruthy();
    expect(screen.getByText('County')).toBeTruthy();
  });

  it('clears SN-specific fields when switching from SN to ALF', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Special Needs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adult' }));
    fireEvent.click(screen.getByRole('button', { name: 'ALF' }));
    expect(screen.queryByText('Age Group')).toBeFalsy();
  });
});

describe('NewReferralForm — Insurance (optional, multi-select)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(true);
  });

  it('renders insurance as a multi-select with checkboxes', () => {
    renderForm();
    expect(screen.getByText('Insurance Plans')).toBeTruthy();
    expect(screen.getByText('Fidelis Care')).toBeTruthy();
    expect(screen.getByText('Medicaid')).toBeTruthy();
  });

  it('insurance is optional — no required marker', () => {
    renderForm();
    const label = screen.getByText('Insurance Plans');
    const container = label.closest('div');
    const requiredMarkers = container?.querySelectorAll('span');
    const hasRequiredStar = Array.from(requiredMarkers || []).some((s) => s.textContent === '*');
    expect(hasRequiredStar).toBe(false);
  });

  it('generates plan detail inputs when multiple insurances are selected', () => {
    renderForm();
    const fidelisCheckbox = screen.getAllByRole('checkbox').find((cb) => {
      const label = cb.closest('label');
      return label?.textContent?.includes('Fidelis Care');
    });
    const medicaidCheckbox = screen.getAllByRole('checkbox').find((cb) => {
      const label = cb.closest('label');
      return label?.textContent?.includes('Medicaid');
    });
    fireEvent.click(fidelisCheckbox);
    fireEvent.click(medicaidCheckbox);
    expect(screen.getByPlaceholderText('Fidelis Care — member ID or plan #')).toBeTruthy();
    expect(screen.getByPlaceholderText('Medicaid — member ID or plan #')).toBeTruthy();
  });
});

describe('NewReferralForm — Special Needs requirements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(true);
  });

  it('shows Adult and Pediatric buttons for SN', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Special Needs' }));
    expect(screen.getByRole('button', { name: 'Adult' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pediatric' })).toBeTruthy();
  });

  it('shows county dropdown from agencies.js', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Special Needs' }));
    const countySelect = screen.getAllByRole('combobox').find((s) => {
      const options = within(s).queryAllByRole('option');
      return options.some((o) => o.textContent === 'Bronx');
    });
    expect(countySelect).toBeTruthy();
    const options = within(countySelect).getAllByRole('option');
    const countyNames = options.map((o) => o.textContent);
    expect(countyNames).toContain('Bronx');
    expect(countyNames).toContain('Kings');
    expect(countyNames).toContain('Putnam');
    expect(countyNames).toContain('Westchester');
  });

  it('auto-assigns WB for Kings county (WB only)', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Special Needs' }));
    const countySelect = screen.getAllByRole('combobox').find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Kings')
    );
    fireEvent.change(countySelect, { target: { value: 'Kings' } });
    expect(screen.getByText(/auto-assigned for Kings county/i)).toBeTruthy();
    expect(screen.getByText('WB')).toBeTruthy();
  });

  it('shows WB/WBII chooser for ambiguous counties like Bronx', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Special Needs' }));
    const countySelect = screen.getAllByRole('combobox').find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Bronx')
    );
    fireEvent.change(countySelect, { target: { value: 'Bronx' } });
    expect(screen.getByText(/served by both agencies/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wellbound (WB)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wellbound II (WBII)' })).toBeTruthy();
  });

  it('validation fails without age group and county for SN', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Special Needs' }));

    // Fill other required fields
    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'John' } });
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByPlaceholderText('(XXX) XXX-XXXX'), { target: { value: '1234567890' } });

    // Try to submit
    fireEvent.click(screen.getByRole('button', { name: 'Create Referral' }));

    const errors = screen.getAllByText('Required for Special Needs');
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('NewReferralForm — Priority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(true);
  });

  it('does not render any priority selector in the UI', () => {
    renderForm();
    expect(screen.queryByText('Priority')).toBeFalsy();
    expect(screen.queryByText('Low')).toBeFalsy();
    expect(screen.queryByText('High')).toBeFalsy();
    expect(screen.queryByText('Critical')).toBeFalsy();
  });

  it('defaults priority to Normal in the submission payload', async () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'ALF' }));

    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Smith' } });
    fireEvent.change(screen.getByPlaceholderText('(XXX) XXX-XXXX'), { target: { value: '5551234567' } });

    // Select source and marketer
    const comboboxes = screen.getAllByRole('combobox');
    const sourceSelect = comboboxes.find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Hospital A')
    );
    const marketerSelect = comboboxes.find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Jane Doe')
    );
    const facilitySelect = comboboxes.find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Sunrise ALF')
    );

    if (sourceSelect) fireEvent.change(sourceSelect, { target: { value: 'src_1' } });
    if (marketerSelect) fireEvent.change(marketerSelect, { target: { value: 'mkt_1' } });
    if (facilitySelect) fireEvent.change(facilitySelect, { target: { value: 'fac_1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Referral' }));

    await vi.waitFor(() => {
      expect(createReferral).toHaveBeenCalled();
    });

    const referralPayload = createReferral.mock.calls[0][0];
    expect(referralPayload.priority).toBe('Normal');
  });
});

describe('NewReferralForm — Services conditional on division', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(true);
  });

  it('does not show service checkboxes until division is selected', () => {
    renderForm();
    // Expand referral details
    fireEvent.click(screen.getByText('Referral Details'));
    expect(screen.getByText(/select a division first/i)).toBeTruthy();
  });

  it('shows ABA for Special Needs but not for ALF', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'ALF' }));
    fireEvent.click(screen.getByText('Referral Details'));

    const checkboxLabels = screen.getAllByRole('checkbox')
      .map((cb) => cb.closest('label')?.textContent)
      .filter(Boolean);

    expect(checkboxLabels).not.toContain('ABA');

    // Switch to SN
    fireEvent.click(screen.getByRole('button', { name: 'Special Needs' }));
    const snLabels = screen.getAllByRole('checkbox')
      .map((cb) => cb.closest('label')?.textContent)
      .filter(Boolean);
    expect(snLabels).toContain('ABA');
  });
});

describe('NewReferralForm — services_under_licence in submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(true);
  });

  it('sends services_under_licence=WB for Kings county', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Special Needs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adult' }));

    const countySelect = screen.getAllByRole('combobox').find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Kings')
    );
    fireEvent.change(countySelect, { target: { value: 'Kings' } });

    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'User' } });
    fireEvent.change(screen.getByPlaceholderText('(XXX) XXX-XXXX'), { target: { value: '5551112222' } });

    const comboboxes = screen.getAllByRole('combobox');
    const sourceSelect = comboboxes.find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Hospital A')
    );
    const marketerSelect = comboboxes.find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Jane Doe')
    );
    if (sourceSelect) fireEvent.change(sourceSelect, { target: { value: 'src_1' } });
    if (marketerSelect) fireEvent.change(marketerSelect, { target: { value: 'mkt_1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Referral' }));

    await vi.waitFor(() => {
      expect(createReferral).toHaveBeenCalled();
    });

    const payload = createReferral.mock.calls[0][0];
    expect(payload.services_under_licence).toBe('WB');
    expect(payload.sn_age_group).toBe('Adult');
  });

  it('sends chosen licence for ambiguous county after user picks', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Special Needs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pediatric' }));

    const countySelect = screen.getAllByRole('combobox').find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Bronx')
    );
    fireEvent.change(countySelect, { target: { value: 'Bronx' } });

    // Choose WBII
    fireEvent.click(screen.getByRole('button', { name: 'Wellbound II (WBII)' }));

    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Child' } });
    fireEvent.change(screen.getByPlaceholderText('(XXX) XXX-XXXX'), { target: { value: '5559998888' } });

    const comboboxes = screen.getAllByRole('combobox');
    const sourceSelect = comboboxes.find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Hospital A')
    );
    const marketerSelect = comboboxes.find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Jane Doe')
    );
    if (sourceSelect) fireEvent.change(sourceSelect, { target: { value: 'src_1' } });
    if (marketerSelect) fireEvent.change(marketerSelect, { target: { value: 'mkt_1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Referral' }));

    await vi.waitFor(() => {
      expect(createReferral).toHaveBeenCalled();
    });

    const payload = createReferral.mock.calls[0][0];
    expect(payload.services_under_licence).toBe('WBII');
    expect(payload.sn_age_group).toBe('Pediatric');
  });
});
