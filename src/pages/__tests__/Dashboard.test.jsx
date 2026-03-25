import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Permission key unit tests ───────────────────────────────────────────────

import { PERMISSION_KEYS, PERMISSION_CATALOG, PERMISSION_CATEGORIES } from '../../data/permissionKeys.js';

describe('Dashboard permission keys', () => {
  it('defines DASHBOARD_MODE_TOGGLE', () => {
    expect(PERMISSION_KEYS.DASHBOARD_MODE_TOGGLE).toBe('dashboard.mode_toggle');
  });

  it('has a catalog entry for DASHBOARD_MODE_TOGGLE', () => {
    const entry = PERMISSION_CATALOG.find((c) => c.key === PERMISSION_KEYS.DASHBOARD_MODE_TOGGLE);
    expect(entry).toBeTruthy();
    expect(entry.category).toBe('Dashboard');
  });

  it('has "Dashboard" in PERMISSION_CATEGORIES', () => {
    expect(PERMISSION_CATEGORIES).toContain('Dashboard');
  });
});

// ── Integration tests for Dashboard mode branching ──────────────────────────

let mockPrefs = { dashboardMode: 'executive', pinnedPages: [] };
let mockCanToggle = false;
const mockSave = vi.fn();

vi.mock('../../context/UserPreferencesContext.jsx', () => ({
  usePreferences: () => ({ prefs: mockPrefs, save: mockSave, MAX_PINS: 6, pinPage: vi.fn(), unpinPage: vi.fn(), reorderPins: vi.fn() }),
}));

vi.mock('../../hooks/usePermissions.js', () => ({
  usePermissions: () => ({
    can: (key) => {
      if (key === 'dashboard.mode_toggle') return mockCanToggle;
      return true;
    },
    canAny: () => true, canAll: () => true, hasDivision: () => true, granted: new Set(), canAssignTo: () => true,
  }),
}));

vi.mock('../../hooks/useCurrentAppUser.js', () => ({
  useCurrentAppUser: () => ({ appUser: { id: 'usr_1' }, appUserId: 'usr_1', appUserName: 'Test User' }),
}));

vi.mock('react-router-dom', () => ({
  useOutletContext: () => ({ division: 'All' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/', state: null }),
  Link: ({ children, ...p }) => <a {...p}>{children}</a>,
}));

vi.mock('../../hooks/usePipelineData.js', () => ({
  usePipelineData: () => ({
    data: [
      { _id: 'r1', id: 'ref_1', current_stage: 'Intake', division: 'ALF', patientName: 'Alice', patient_id: 'p1', referral_date: new Date().toISOString(), updated_at: new Date().toISOString(), intake_owner_id: 'usr_1', referral_source_id: 'src_1' },
      { _id: 'r2', id: 'ref_2', current_stage: 'F2F/MD Orders Pending', division: 'Special Needs', patientName: 'Bob', patient_id: 'p2', referral_date: new Date().toISOString(), updated_at: new Date().toISOString(), intake_owner_id: 'usr_other', referral_source_id: 'src_2' },
    ],
    loading: false,
  }),
}));

vi.mock('../../hooks/useLookups.js', () => ({
  useLookups: () => ({
    resolveUser: () => '—', resolveMarketer: () => '—', resolveSource: () => 'Hospital',
    resolveFacility: () => '—', resolvePhysician: () => '—',
  }),
}));

vi.mock('../../store/careStore.js', () => ({
  useCareStore: (sel) => sel({ tasks: {} }),
}));

vi.mock('../../context/PatientDrawerContext.jsx', () => ({
  usePatientDrawer: () => ({ open: vi.fn() }),
}));

vi.mock('../../hooks/useRefreshTrigger.js', () => ({
  triggerDataRefresh: vi.fn(),
}));

vi.mock('../../hooks/useIsMobile.js', () => ({
  useIsMobile: () => false,
}));

vi.mock('../../components/common/Skeleton.jsx', () => ({
  SkeletonStatCard: () => <div />, SkeletonTableRow: () => <tr />,
  SkeletonStageCard: () => <div />, SkeletonRect: () => <div />,
}));

vi.mock('../../components/forms/NewReferralForm.jsx', () => ({ default: () => null }));

const { default: Dashboard } = await import('../Dashboard.jsx');

describe('Dashboard — mode routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanToggle = false;
    mockPrefs = { dashboardMode: 'executive', pinnedPages: [] };
  });

  it('renders executive dashboard when dashboardMode is "executive"', () => {
    mockPrefs.dashboardMode = 'executive';
    render(<Dashboard />);
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText(/Active Referrals/i)).toBeTruthy();
  });

  it('renders caseload dashboard when dashboardMode is "caseload"', () => {
    mockPrefs.dashboardMode = 'caseload';
    render(<Dashboard />);
    expect(screen.getByText('My Caseload')).toBeTruthy();
    expect(screen.getByText('My Cases')).toBeTruthy();
  });

  it('does NOT show mode toggle when user lacks DASHBOARD_MODE_TOGGLE permission', () => {
    mockCanToggle = false;
    render(<Dashboard />);
    expect(screen.queryByTestId('dashboard-mode-toggle')).toBeFalsy();
  });

  it('shows mode toggle when user has DASHBOARD_MODE_TOGGLE permission', () => {
    mockCanToggle = true;
    render(<Dashboard />);
    expect(screen.getByTestId('dashboard-mode-toggle')).toBeTruthy();
  });

  it('toggle button shows "My Caseload" when in executive mode', () => {
    mockCanToggle = true;
    mockPrefs.dashboardMode = 'executive';
    render(<Dashboard />);
    expect(screen.getByTestId('dashboard-mode-toggle').textContent).toContain('My Caseload');
  });

  it('toggle button shows "Executive View" when in caseload mode', () => {
    mockCanToggle = true;
    mockPrefs.dashboardMode = 'caseload';
    render(<Dashboard />);
    expect(screen.getByTestId('dashboard-mode-toggle').textContent).toContain('Executive View');
  });

  it('calls save with new mode when toggle is clicked', () => {
    mockCanToggle = true;
    mockPrefs.dashboardMode = 'executive';
    render(<Dashboard />);
    fireEvent.click(screen.getByTestId('dashboard-mode-toggle'));
    expect(mockSave).toHaveBeenCalledWith({ dashboardMode: 'caseload' });
  });
});

describe('Dashboard — caseload queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanToggle = false;
    mockPrefs = { dashboardMode: 'caseload', pinnedPages: [] };
  });

  it('only shows referrals where intake_owner_id matches signed-in user', () => {
    render(<Dashboard />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.queryByText('Bob')).toBeFalsy();
  });

  it('shows module/stage column for each queue item', () => {
    render(<Dashboard />);
    const table = screen.getByTestId('caseload-table');
    const headers = table.querySelectorAll('th');
    const headerTexts = Array.from(headers).map((h) => h.textContent);
    expect(headerTexts).toContain('Module / Stage');
  });

  it('shows source column for context', () => {
    render(<Dashboard />);
    expect(screen.getByText('Hospital')).toBeTruthy();
  });

  it('shows search and sort controls', () => {
    render(<Dashboard />);
    expect(screen.getByPlaceholderText('Search my cases...')).toBeTruthy();
    const sortButtons = screen.getAllByRole('button').filter((b) =>
      ['Days', 'Name', 'Stage'].some((l) => b.textContent.startsWith(l))
    );
    expect(sortButtons.length).toBeGreaterThanOrEqual(3);
  });

  it('filters queue by search text', () => {
    render(<Dashboard />);
    fireEvent.change(screen.getByPlaceholderText('Search my cases...'), { target: { value: 'nonexistent' } });
    expect(screen.queryByText('Alice')).toBeFalsy();
  });
});

describe('Dashboard — settings integration', () => {
  it('defaults to executive when dashboardMode is not set', () => {
    mockPrefs = { pinnedPages: [] };
    render(<Dashboard />);
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });
});
