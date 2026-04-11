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
      marketers: {
        m1: { _id: 'm1', id: 'mkt_1', first_name: 'Jane', last_name: 'Doe', user_id: 'usr_other', division: 'Both' },
        m2: { _id: 'm2', id: 'mkt_2', first_name: 'Bob', last_name: 'Smith', user_id: 'usr_bob', division: 'ALF' },
      },
      referralSources: { s1: { _id: 's1', id: 'src_1', name: 'Hospital A' } },
      roles: { r1: { _id: 'r1', id: 'rol_001', name: 'Intake Coordinator' } },
      facilities: { f1: { _id: 'f1', id: 'fac_1', name: 'Sunrise ALF', is_active: 'TRUE' } },
      networkFacilities: { nf1: { _id: 'nf1', id: 'fac_1', name: 'Sunrise ALF', region: 'KINGS' } },
      marketerFacilities: {
        mf1: { _id: 'mf1', facility_id: 'fac_1', marketer_id: 'mkt_1', is_primary: true },
        mf2: { _id: 'mf2', facility_id: 'fac_1', marketer_id: 'mkt_2', is_primary: false },
      },
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

function selectDivision(value) {
  const selects = screen.getAllByRole('combobox');
  const divSelect = selects.find((s) => [...s.options].some((o) => o.value === 'ALF'));
  fireEvent.change(divSelect, { target: { value } });
}

function selectAgeGroup(value) {
  const selects = screen.getAllByRole('combobox');
  const ageSelect = selects.find((s) => [...s.options].some((o) => o.value === 'Adult'));
  fireEvent.change(ageSelect, { target: { value } });
}

function selectEntity(value) {
  const selects = screen.getAllByRole('combobox');
  const entitySelect = selects.find((s) => [...s.options].some((o) => o.value === 'WB'));
  fireEvent.change(entitySelect, { target: { value } });
}

describe('NewReferralForm — Division selector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(true);
  });

  it('renders division selector at the top with ALF and Special Needs options', () => {
    renderForm();
    const selects = screen.getAllByRole('combobox');
    const divSelect = selects.find((s) => [...s.options].some((o) => o.value === 'ALF'));
    expect(divSelect).toBeTruthy();
    const optionValues = [...divSelect.options].map((o) => o.value);
    expect(optionValues).toContain('ALF');
    expect(optionValues).toContain('Special Needs');
  });

  it('does not show facility selector until ALF is chosen', () => {
    renderForm();
    expect(screen.queryByText('Facility')).toBeFalsy();
    selectDivision('ALF');
    expect(screen.getByText('Facility')).toBeTruthy();
  });

  it('does not show Adult/Pediatric + County until Special Needs is chosen', () => {
    renderForm();
    expect(screen.queryByText('Age Group')).toBeFalsy();
    expect(screen.queryByText('County')).toBeFalsy();
    selectDivision('Special Needs');
    expect(screen.getByText('Age Group')).toBeTruthy();
    expect(screen.getByText('County')).toBeTruthy();
  });

  it('clears SN-specific fields when switching from SN to ALF', () => {
    renderForm();
    selectDivision('Special Needs');
    selectAgeGroup('Adult');
    selectDivision('ALF');
    expect(screen.queryByText('Age Group')).toBeFalsy();
  });
});

describe('NewReferralForm — Insurance (optional, multi-select)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(true);
  });

  it('renders insurance as a dropdown selector', () => {
    renderForm();
    expect(screen.getByText('Insurance Plans')).toBeTruthy();
    const trigger = screen.getByText('Select insurance plans...');
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
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

  it('generates plan detail inputs when plans are selected from dropdown', () => {
    renderForm();
    fireEvent.click(screen.getByText('Select insurance plans...'));
    fireEvent.click(screen.getByText('Fidelis Care'));
    fireEvent.click(screen.getByText('Medicaid'));
    expect(screen.getByPlaceholderText('Fidelis Care member ID or plan #')).toBeTruthy();
    expect(screen.getByPlaceholderText('Medicaid member ID or plan #')).toBeTruthy();
  });
});

describe('NewReferralForm — Special Needs requirements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(true);
  });

  it('shows Adult and Pediatric options in age group select for SN', () => {
    renderForm();
    selectDivision('Special Needs');
    const selects = screen.getAllByRole('combobox');
    const ageSelect = selects.find((s) => [...s.options].some((o) => o.value === 'Adult'));
    expect(ageSelect).toBeTruthy();
    const optionValues = [...ageSelect.options].map((o) => o.value);
    expect(optionValues).toContain('Adult');
    expect(optionValues).toContain('Pediatric');
  });

  it('shows county dropdown from agencies.js', () => {
    renderForm();
    selectDivision('Special Needs');
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
    selectDivision('Special Needs');
    const countySelect = screen.getAllByRole('combobox').find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Kings')
    );
    fireEvent.change(countySelect, { target: { value: 'Kings' } });
    expect(screen.getByText(/auto-assigned for Kings/i)).toBeTruthy();
  });

  it('shows WB/WBII chooser for ambiguous counties like Bronx', () => {
    renderForm();
    selectDivision('Special Needs');
    const countySelect = screen.getAllByRole('combobox').find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Bronx')
    );
    fireEvent.change(countySelect, { target: { value: 'Bronx' } });
    const selects = screen.getAllByRole('combobox');
    const entitySelect = selects.find((s) => [...s.options].some((o) => o.value === 'WB'));
    expect(entitySelect).toBeTruthy();
    const optionValues = [...entitySelect.options].map((o) => o.value);
    expect(optionValues).toContain('WB');
    expect(optionValues).toContain('WBII');
  });

  it('validation fails without age group and county for SN', async () => {
    renderForm();
    selectDivision('Special Needs');

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

    selectDivision('ALF');

    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Smith' } });
    fireEvent.change(screen.getByPlaceholderText('(XXX) XXX-XXXX'), { target: { value: '2125551234' } });

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
    selectDivision('ALF');
    fireEvent.click(screen.getByText('Referral Details'));

    const checkboxLabels = screen.getAllByRole('checkbox')
      .map((cb) => cb.closest('label')?.textContent)
      .filter(Boolean);

    expect(checkboxLabels).not.toContain('ABA');

    // Switch to SN
    selectDivision('Special Needs');
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
    selectDivision('Special Needs');
    selectAgeGroup('Adult');

    const countySelect = screen.getAllByRole('combobox').find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Kings')
    );
    fireEvent.change(countySelect, { target: { value: 'Kings' } });

    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'User' } });
    fireEvent.change(screen.getByPlaceholderText('(XXX) XXX-XXXX'), { target: { value: '2125551234' } });

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
    selectDivision('Special Needs');
    selectAgeGroup('Pediatric');

    const countySelect = screen.getAllByRole('combobox').find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Bronx')
    );
    fireEvent.change(countySelect, { target: { value: 'Bronx' } });

    // Choose WBII
    selectEntity('WBII');

    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Child' } });
    fireEvent.change(screen.getByPlaceholderText('(XXX) XXX-XXXX'), { target: { value: '7185559876' } });

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

describe('NewReferralForm — Facility-Marketer filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(true);
  });

  it('shows all marketers when no facility is selected (non-ALF)', () => {
    renderForm();
    selectDivision('Special Needs');

    const comboboxes = screen.getAllByRole('combobox');
    const marketerSelect = comboboxes.find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent.includes('Jane Doe'))
    );
    expect(marketerSelect).toBeTruthy();
    const options = within(marketerSelect).getAllByRole('option');
    const labels = options.map((o) => o.textContent);
    expect(labels.some((l) => l.includes('Jane Doe'))).toBe(true);
    expect(labels.some((l) => l.includes('Bob Smith'))).toBe(true);
  });

  it('filters marketer list to facility-linked marketers when ALF facility is chosen', () => {
    renderForm();
    selectDivision('ALF');

    const comboboxes = screen.getAllByRole('combobox');
    const facilitySelect = comboboxes.find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Sunrise ALF')
    );
    fireEvent.change(facilitySelect, { target: { value: 'fac_1' } });

    const marketerSelect = comboboxes.find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent.includes('Primary'))
    );
    if (marketerSelect) {
      const options = within(marketerSelect).getAllByRole('option');
      const labels = options.map((o) => o.textContent);
      expect(labels.some((l) => l.includes('Jane Doe') && l.includes('Primary'))).toBe(true);
      expect(labels.some((l) => l.includes('Bob Smith'))).toBe(true);
    }
  });

  it('auto-selects the primary marketer when a facility is chosen', () => {
    renderForm();
    selectDivision('ALF');

    const comboboxes = screen.getAllByRole('combobox');
    const facilitySelect = comboboxes.find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Sunrise ALF')
    );
    fireEvent.change(facilitySelect, { target: { value: 'fac_1' } });

    expect(screen.getByText(/Primary marketer for this facility/i)).toBeTruthy();
  });

  it('shows facility marketer count indicator', () => {
    renderForm();
    selectDivision('ALF');

    const comboboxes = screen.getAllByRole('combobox');
    const facilitySelect = comboboxes.find((s) =>
      within(s).queryAllByRole('option').some((o) => o.textContent === 'Sunrise ALF')
    );
    fireEvent.change(facilitySelect, { target: { value: 'fac_1' } });

    expect(screen.getByText(/2 marketers assigned to this facility/i)).toBeTruthy();
  });
});
