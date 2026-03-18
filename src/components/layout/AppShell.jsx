import { useState, useEffect } from 'react';
import { Outlet, useLocation, NavLink } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import SubNav from './SubNav.jsx';
import PatientDrawer from '../patient/PatientDrawer.jsx';
import NewReferralForm from '../forms/NewReferralForm.jsx';
import HydrationScreen from '../common/HydrationScreen.jsx';
import { SLUG_TO_STAGE } from '../../data/stageConfig.js';
import palette, { hexToRgba } from '../../utils/colors.js';
import { useTheme } from '../../utils/ThemeContext.jsx';
import { usePreferences } from '../../context/UserPreferencesContext.jsx';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import { triggerDataRefresh } from '../../hooks/useRefreshTrigger.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';
import { prefetchClinicians } from '../../hooks/useEsperClinicians.js';
import { useCareStore } from '../../store/careStore.js';
import { hydrateStore } from '../../store/hydrate.js';
import { startSync, stopSync } from '../../store/sync.js';

function getBreadcrumbs(pathname) {
  const map = {
    '/': ['Dashboard'],
    '/pipeline': ['Pipeline'],
    '/patients': ['Patients'],
    '/tasks': ['Tasks'],
    '/reports': ['Reports'],
    '/directory/marketers': ['Directory', 'Marketers'],

    '/directory/facilities': ['Directory', 'Facilities'],
    '/directory/physicians': ['Directory', 'Physicians'],
    '/directory/campaigns': ['Directory', 'Campaigns'],
    '/directory/referral-sources': ['Directory', 'Referral Sources'],
    '/team': ['System', 'Team'],
    '/admin/users': ['System', 'User Management'],
    '/admin/settings': ['System', 'Settings'],
    '/admin/data-tools': ['System', 'Data Tools'],
  };
  if (pathname.startsWith('/modules/')) {
    const slug = pathname.replace('/modules/', '');
    const stage = SLUG_TO_STAGE[slug];
    return stage ? ['Modules', stage] : ['Modules'];
  }
  return map[pathname] || [pathname.replace('/', '').replace(/-/g, ' ')];
}

export default function AppShell() {
  useTheme();
  const { prefs } = usePreferences();
  const { open: openDrawer } = usePatientDrawer();
  const isMobile = useIsMobile();
  const hydrated = useCareStore((s) => s.hydrated);

  const [division, setDivision] = useState('All');
  const [roleMode, setRoleMode] = useState(() => localStorage.getItem('carestream_rolemode') || 'intake');
  const [showNewReferral, setShowNewReferral] = useState(false);
  const location = useLocation();
  const breadcrumbs = getBreadcrumbs(location.pathname);

  function handleRoleModeChange(mode) {
    setRoleMode(mode);
    localStorage.setItem('carestream_rolemode', mode);
  }

  // Hydrate the normalized store on mount (replaces old prefetch* calls).
  // Esper clinicians stay on their own cache — that pattern works great.
  useEffect(() => {
    hydrateStore();
    prefetchClinicians();
    return () => stopSync();
  }, []);

  // Start background polling once hydration completes
  useEffect(() => {
    if (hydrated) startSync();
  }, [hydrated]);

  // Ctrl+N / Cmd+N — open New Referral form from anywhere (desktop only)
  useEffect(() => {
    if (!hydrated || isMobile) return;
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        const tag = document.activeElement?.tagName;
        const editable = document.activeElement?.isContentEditable;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return;
        e.preventDefault();
        setShowNewReferral(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hydrated, isMobile]);

  // Show branded loading screen until the store is ready.
  // All hooks are above — this is safe per Rules of Hooks.
  if (!hydrated) return <HydrationScreen />;

  const newReferralModal = showNewReferral && (
    <NewReferralForm
      onClose={() => setShowNewReferral(false)}
      onSuccess={({ patient, referral }) => {
        triggerDataRefresh();
        if (!isMobile) openDrawer(patient, referral);
      }}
    />
  );

  // ── Mobile layout ─────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: palette.backgroundLight.hex }}>

        {/* Mobile top bar */}
        <div style={{
          height: 52, flexShrink: 0,
          background: palette.primaryDeepPlum.hex,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px',
        }}>
          <img src="/logo-cs.png" alt="CareStream" style={{ height: 26, objectFit: 'contain' }} />
          <button
            onClick={() => setShowNewReferral(true)}
            style={{
              padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: palette.accentGreen.hex,
              color: palette.backgroundLight.hex,
              fontSize: 13, fontWeight: 700,
            }}
          >
            + New Referral
          </button>
        </div>

        {/* Page content — padded at bottom to avoid overlap with bottom nav */}
        <main style={{ flex: 1, overflowY: 'auto', paddingBottom: 72 }}>
          <Outlet context={{ division: 'All', roleMode: 'intake' }} />
        </main>

        {/* Mobile bottom nav — Dashboard only */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: palette.primaryDeepPlum.hex,
          borderTop: `1px solid ${hexToRgba('#ffffff', 0.1)}`,
          display: 'flex',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          zIndex: 200,
        }}>
          <NavLink
            to="/"
            end
            style={({ isActive }) => ({
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '10px 0 12px', gap: 3, border: 'none', background: 'none', cursor: 'pointer',
              color: isActive ? '#ffffff' : hexToRgba('#ffffff', 0.45),
              textDecoration: 'none', fontSize: 10, fontWeight: 650, letterSpacing: '0.04em',
              borderTop: isActive ? `2px solid ${palette.accentGreen.hex}` : '2px solid transparent',
              transition: 'color 0.15s',
            })}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/>
              <path d="M9 21V12h6v9"/>
            </svg>
            DASHBOARD
          </NavLink>

          <button
            onClick={() => setShowNewReferral(true)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '10px 0 12px', gap: 3, border: 'none', background: 'none', cursor: 'pointer',
              color: hexToRgba('#ffffff', 0.45),
              fontSize: 10, fontWeight: 650, letterSpacing: '0.04em',
              borderTop: '2px solid transparent',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="16"/>
              <line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
            NEW REFERRAL
          </button>
        </div>

        {newReferralModal}
      </div>
    );
  }

  // ── Desktop layout (unchanged) ────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: palette.backgroundLight.hex,
        overflow: 'hidden',
      }}
    >
      <TopBar breadcrumbs={breadcrumbs} />

      {prefs.subnavEnabled && prefs.pinnedPages.length > 0 && (
        <SubNav pinnedPages={prefs.pinnedPages} />
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar division={division} onDivisionChange={setDivision} roleMode={roleMode} onRoleModeChange={handleRoleModeChange} />

        <main
          style={{
            flex: 1,
            overflow: 'auto',
            background: palette.backgroundLight.hex,
          }}
        >
          <Outlet context={{ division, roleMode }} />
        </main>
      </div>

      <PatientDrawer />
      {newReferralModal}
    </div>
  );
}
