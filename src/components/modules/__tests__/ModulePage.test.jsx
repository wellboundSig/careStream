import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// ── Unit tests for column model (no React rendering) ────────────────────────

import { MODULE_COLUMN_DEFS, useColumnVisibility, useColumnFilters } from '../../../utils/columnModel.jsx';

describe('MODULE_COLUMN_DEFS', () => {
  it('includes a "source" column', () => {
    const sourceCol = MODULE_COLUMN_DEFS.find((c) => c.key === 'source');
    expect(sourceCol).toBeTruthy();
    expect(sourceCol.label).toBe('Source');
    expect(sourceCol.defaultOn).toBe(true);
    expect(sourceCol.filterable).toBe(true);
  });

  it('has "patient" as always-on', () => {
    const patientCol = MODULE_COLUMN_DEFS.find((c) => c.key === 'patient');
    expect(patientCol.alwaysOn).toBe(true);
  });

  it('includes insurance and facility as optional columns', () => {
    const insurance = MODULE_COLUMN_DEFS.find((c) => c.key === 'insurance');
    const facility = MODULE_COLUMN_DEFS.find((c) => c.key === 'facility');
    expect(insurance).toBeTruthy();
    expect(insurance.defaultOn).toBe(false);
    expect(facility).toBeTruthy();
    expect(facility.defaultOn).toBe(false);
  });

  it('does not include a "priority" column', () => {
    expect(MODULE_COLUMN_DEFS.find((c) => c.key === 'priority')).toBeFalsy();
  });
});

// ── Permission keys for module visibility ───────────────────────────────────

import { PERMISSION_KEYS, PERMISSION_CATALOG } from '../../../data/permissionKeys.js';

describe('Module permission keys', () => {
  it('defines MODULE_INTAKE through MODULE_ADMIN', () => {
    expect(PERMISSION_KEYS.MODULE_INTAKE).toBe('module.intake');
    expect(PERMISSION_KEYS.MODULE_CLINICAL).toBe('module.clinical');
    expect(PERMISSION_KEYS.MODULE_AUTHORIZATION).toBe('module.authorization');
    expect(PERMISSION_KEYS.MODULE_SCHEDULING).toBe('module.scheduling');
    expect(PERMISSION_KEYS.MODULE_ADMIN).toBe('module.admin');
  });

  it('has catalog entries for all module keys', () => {
    const moduleKeys = [
      PERMISSION_KEYS.MODULE_INTAKE,
      PERMISSION_KEYS.MODULE_CLINICAL,
      PERMISSION_KEYS.MODULE_AUTHORIZATION,
      PERMISSION_KEYS.MODULE_SCHEDULING,
      PERMISSION_KEYS.MODULE_ADMIN,
    ];
    moduleKeys.forEach((key) => {
      expect(PERMISSION_CATALOG.find((c) => c.key === key)).toBeTruthy();
    });
  });
});

// ── Integration tests for ModulePage rendering ──────────────────────────────

const mockCan = vi.fn().mockReturnValue(true);
vi.mock('../../../hooks/usePermissions.js', () => ({
  usePermissions: () => ({ can: mockCan, canAny: (...keys) => keys.some((k) => mockCan(k)), granted: new Set() }),
}));

vi.mock('../../../hooks/useCurrentAppUser.js', () => ({
  useCurrentAppUser: () => ({ appUser: { id: 'usr_test' }, appUserId: 'usr_test' }),
}));

vi.mock('../../../hooks/useIsMobile.js', () => ({
  useIsMobile: () => false,
}));

vi.mock('react-router-dom', () => ({
  useOutletContext: () => ({ division: 'All' }),
  useLocation: () => ({ pathname: '/modules/lead-entry' }),
  NavLink: ({ children, ...props }) => <a {...props}>{children}</a>,
}));

const mockReferrals = [
  {
    _id: 'ref1', id: 'ref_001', patient_id: 'pat_001', current_stage: 'Lead Entry',
    division: 'ALF', patientName: 'John Doe', referral_source_id: 'src_1',
    intake_owner_id: 'usr_1', updated_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    patient: { insurance_plan: 'Fidelis Care', medicaid_number: '123456' },
    facility_id: 'fac_1',
  },
  {
    _id: 'ref2', id: 'ref_002', patient_id: 'pat_002', current_stage: 'Lead Entry',
    division: 'Special Needs', patientName: 'Jane Smith', referral_source_id: 'src_2',
    intake_owner_id: 'usr_2', updated_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    patient: { insurance_plan: 'Medicaid' },
  },
];

vi.mock('../../../hooks/usePipelineData.js', () => ({
  usePipelineData: () => ({ data: mockReferrals, loading: false, refetch: vi.fn() }),
}));

vi.mock('../../../hooks/useLookups.js', () => ({
  useLookups: () => ({
    resolveUser: (id) => id === 'usr_1' ? 'Alice' : id === 'usr_2' ? 'Bob' : id || '—',
    resolveMarketer: (id) => id || '—',
    resolveSource: (id) => id === 'src_1' ? 'Hospital A' : id === 'src_2' ? 'Clinic B' : '—',
    resolveFacility: (id) => id === 'fac_1' ? 'Sunrise ALF' : '—',
    resolvePhysician: (id) => '—',
  }),
}));

vi.mock('../../../context/PatientDrawerContext.jsx', () => ({
  usePatientDrawer: () => ({ open: vi.fn() }),
}));

vi.mock('../../../store/careStore.js', () => ({
  useCareStore: (selector) => {
    const state = {
      triageAdult: {},
      triagePediatric: {},
      files: {},
    };
    return selector(state);
  },
}));

vi.mock('../../../store/mutations.js', () => ({
  updateReferralOptimistic: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../utils/recordTransition.js', () => ({
  recordTransition: vi.fn(),
}));

vi.mock('../../../data/stageConfig.js', () => ({
  STAGE_META: {
    'Lead Entry': { displayName: 'Leads', description: 'New referral submissions', color: '#06D4FF', isGlobal: false, isTerminal: false },
  },
}));

vi.mock('../../../utils/stageTransitions.js', () => ({
  canMoveFromTo: () => true,
  needsModal: () => false,
}));

vi.mock('../StagePanel.jsx', () => ({ default: () => <div data-testid="stage-panel" /> }));
vi.mock('../../forms/NewReferralForm.jsx', () => ({ default: () => null }));
vi.mock('../../pipeline/TransitionModal.jsx', () => ({ default: () => null }));

const { default: ModulePage } = await import('../ModulePage.jsx');

function renderModule(props = {}) {
  return render(<ModulePage stage="Lead Entry" {...props} />);
}

describe('ModulePage — Column system', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCan.mockReturnValue(true); });

  it('renders column headers matching MODULE_COLUMN_DEFS defaults', () => {
    renderModule();
    const headers = screen.getAllByRole('columnheader');
    const headerTexts = headers.map((h) => h.textContent.replace('ⓘ', '').trim());
    expect(headerTexts).toContain('Patient');
    expect(headerTexts).toContain('Division');
    expect(headerTexts).toContain('Source');
    expect(headerTexts).toContain('Triage');
    expect(headerTexts).toContain('Days');
    expect(headerTexts).toContain('F2F');
    expect(headerTexts).toContain('Owner');
    expect(headerTexts).toContain('Last Activity');
  });

  it('renders the Source column with resolved values', () => {
    renderModule();
    expect(screen.getByText('Hospital A')).toBeTruthy();
    expect(screen.getByText('Clinic B')).toBeTruthy();
  });

  it('does not render Insurance column by default (it is off)', () => {
    renderModule();
    const headers = screen.getAllByRole('columnheader');
    const headerTexts = headers.map((h) => h.textContent);
    expect(headerTexts).not.toContain('Insurance');
  });

  it('shows Columns button that opens the picker', () => {
    renderModule();
    const colBtn = screen.getByText(/Columns/);
    expect(colBtn).toBeTruthy();
    fireEvent.click(colBtn);
    const labels = screen.getAllByText('Insurance');
    expect(labels.length).toBeGreaterThanOrEqual(1);
    const facilityLabels = screen.getAllByText('Facility');
    expect(facilityLabels.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ModulePage — Filter system', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCan.mockReturnValue(true); });

  it('shows Filters button', () => {
    renderModule();
    expect(screen.getByText(/Filters/)).toBeTruthy();
  });

  it('shows filter inputs when Filters button is clicked', () => {
    renderModule();
    fireEvent.click(screen.getByText(/Filters/));
    const filterInputs = screen.getAllByPlaceholderText(/Division|Source|Owner/i);
    expect(filterInputs.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by source when text is entered', () => {
    renderModule();
    fireEvent.click(screen.getByText(/Filters/));
    const sourceInput = screen.getByPlaceholderText('Source');
    fireEvent.change(sourceInput, { target: { value: 'Hospital' } });
    expect(screen.getByText('Hospital A')).toBeTruthy();
    expect(screen.queryByText('Clinic B')).toBeFalsy();
  });

  it('filter input has a clear mechanism (verified via "clears filter" test)', () => {
    renderModule();
    fireEvent.click(screen.getByText(/Filters/));
    const sourceInput = screen.getByPlaceholderText('Source');
    expect(sourceInput).toBeTruthy();
    expect(sourceInput.parentElement.style.position).toBe('relative');
  });

  it('clears filter when × button is clicked', () => {
    renderModule();
    fireEvent.click(screen.getByText(/Filters/));
    const sourceInput = screen.getByPlaceholderText('Source');
    fireEvent.change(sourceInput, { target: { value: 'Hospital' } });
    expect(screen.queryByText('Clinic B')).toBeFalsy();
    const clearBtn = sourceInput.parentElement.querySelector('button');
    fireEvent.click(clearBtn);
    expect(screen.getByText('Clinic B')).toBeTruthy();
  });

  it('shows "Clear all" button when any filter is active', () => {
    renderModule();
    fireEvent.click(screen.getByText(/Filters/));
    const sourceInput = screen.getByPlaceholderText('Source');
    fireEvent.change(sourceInput, { target: { value: 'xyz' } });
    const clearAll = screen.getByText('Clear all');
    expect(clearAll.style.visibility).toBe('visible');
  });

  it('shows active filter dot indicator on Filters button', () => {
    renderModule();
    fireEvent.click(screen.getByText(/Filters/));
    const sourceInput = screen.getByPlaceholderText('Source');
    fireEvent.change(sourceInput, { target: { value: 'x' } });
    const filtersBtn = screen.getByText(/Filters/).closest('button');
    const dot = filtersBtn.querySelector('span[style*="border-radius: 50%"]');
    expect(dot).toBeTruthy();
  });
});

describe('ModulePage — Place on Hold absent', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCan.mockReturnValue(true); });

  it('does not render a "Place on Hold" button anywhere in the module page', () => {
    renderModule();
    expect(screen.queryByText('Place on Hold')).toBeFalsy();
    expect(screen.queryByText(/place on hold/i)).toBeFalsy();
  });
});

describe('ModulePage — search with clear × button', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCan.mockReturnValue(true); });

  it('shows × button in search when text is entered', () => {
    renderModule();
    const searchInput = screen.getByPlaceholderText('Search patients...');
    fireEvent.change(searchInput, { target: { value: 'john' } });
    const searchContainer = searchInput.closest('div');
    const clearBtn = searchContainer.querySelector('button');
    expect(clearBtn).toBeTruthy();
  });

  it('clears search when × is clicked', () => {
    renderModule();
    const searchInput = screen.getByPlaceholderText('Search patients...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
    expect(screen.queryByText('John Doe')).toBeFalsy();
    const clearBtn = searchInput.closest('div').querySelector('button');
    fireEvent.click(clearBtn);
    expect(screen.getByText('John Doe')).toBeTruthy();
  });
});

describe('ModulePage — button color conventions', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCan.mockReturnValue(true); });

  it('renders "+ New Referral" as a green (actionable) button for Lead Entry', () => {
    renderModule();
    const newRefBtns = screen.getAllByText('+ New Referral');
    const greenBtn = newRefBtns.find((el) => el.style.background?.includes('#6EC72B'));
    expect(greenBtn).toBeTruthy();
  });
});
