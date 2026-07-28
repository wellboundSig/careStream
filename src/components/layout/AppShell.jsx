import { useState, useEffect } from 'react';
import { Outlet, useLocation, NavLink } from 'react-router-dom';
import { UserButton } from '@clerk/react';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import SubNav from './SubNav.jsx';
import SplitView from './SplitView.jsx';
import NotificationBell from './NotificationBell.jsx';
import PatientDrawer from '../patient/PatientDrawer.jsx';
import NewReferralForm from '../forms/NewReferralForm.jsx';
import HydrationScreen from '../common/HydrationScreen.jsx';
import WaitingRoom from '../common/WaitingRoom.jsx';
import RealtimeToasts from '../common/RealtimeToasts.jsx';
import { SLUG_TO_STAGE } from '../../data/stageConfig.js';
import palette, { hexToRgba } from '../../utils/colors.js';
import { useTheme } from '../../utils/ThemeContext.jsx';
import { usePreferences } from '../../context/UserPreferencesContext.jsx';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import { triggerDataRefresh } from '../../hooks/useRefreshTrigger.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';
import { prefetchClinicians } from '../../hooks/useEsperClinicians.js';
import { useCareStore, setupBroadcastSync } from '../../store/careStore.js';
import { hydrateStore, hydrateNotificationsForUser } from '../../store/hydrate.js';
import { startSync, stopSync } from '../../store/sync.js';
import { startRealtime, stopRealtime } from '../../store/realtime.js';
import { isPopOutWindow, openPopOut } from '../../utils/windowManager.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { useLookups } from '../../hooks/useLookups.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';

const UNASSIGNED_ROLE_ID = 'rol_016';
const NAV_TEXT = '#F7F7FA';

function getBreadcrumbs(pathname) {
  const map = {
    '/': ['Dashboard'],
    '/pipeline': ['Pipeline'],
    '/patients': ['Patients'],
    '/tasks': ['Tasks'],
    '/calendar': ['Calendar'],
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

const NAV_TEXT_POPOUT = '#F7F7FA';

function MobileNavItem({ to, end, label, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 0 10px',
        gap: 3,
        textDecoration: 'none',
        color: isActive ? '#ffffff' : hexToRgba('#ffffff', 0.45),
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.04em',
        borderTop: isActive ? `2px solid ${palette.accentGreen.hex}` : '2px solid transparent',
        WebkitTapHighlightColor: 'transparent',
      })}
    >
      {children}
      {label}
    </NavLink>
  );
}

export default function AppShell() {
  useTheme();
  const { prefs, save, reorderPins } = usePreferences();
  const { open: openDrawer } = usePatientDrawer();
  const isMobile = useIsMobile();
  const hydrated = useCareStore((s) => s.hydrated);
  const { appUser, appUserId, appUserName } = useCurrentAppUser();
  const { canAny, hasDivision } = usePermissions();
  const { resolveRole } = useLookups();
  const canEnterLead = canAny(PERMISSION_KEYS.LEADS_CREATE, PERMISSION_KEYS.REFERRAL_CREATE);
  const canScheduling = canAny(PERMISSION_KEYS.MODULE_SCHEDULING, PERMISSION_KEYS.SCHEDULING_SOC_PENDING_LOG);
  const canPatients = canAny(PERMISSION_KEYS.REFERRAL_VIEW, PERMISSION_KEYS.REFERRAL_VIEW_ALL, PERMISSION_KEYS.MODULE_INTAKE);
  // Conflict module + drawer are day-to-day for marketers / clinical / schedulers.
  const canConflicts = canAny(
    PERMISSION_KEYS.MODULE_CLINICAL,
    PERMISSION_KEYS.CONFLICT_FLAG,
    PERMISSION_KEYS.CONFLICT_RESOLVE,
    PERMISSION_KEYS.SNAPSHOT_EDIT_CONFLICTS,
    PERMISSION_KEYS.REFERRAL_VIEW,
    PERMISSION_KEYS.REFERRAL_VIEW_ALL,
  );
  const isPopOut = isPopOutWindow();
  const roleName = appUser?.role_id ? resolveRole(appUser.role_id) : '';
  const isUnassigned = !!(
    appUser?.role_id === UNASSIGNED_ROLE_ID
    || String(roleName).toLowerCase() === 'unassigned'
  );

  const [division, setDivision] = useState('All');
  const [roleMode, setRoleMode] = useState(() => localStorage.getItem('carestream_rolemode') || 'intake');
  const [showNewReferral, setShowNewReferral] = useState(false);
  const location = useLocation();
  const breadcrumbs = getBreadcrumbs(location.pathname);

  useEffect(() => {
    const alf = hasDivision('ALF');
    const sn = hasDivision('Special Needs');
    if (alf && !sn) {
      if (division !== 'ALF') setDivision('ALF');
      return;
    }
    if (sn && !alf) {
      if (division !== 'Special Needs') setDivision('Special Needs');
      return;
    }
  }, [hasDivision, division]);

  const splitEnabled = prefs.splitScreenEnabled || false;
  function toggleSplit() {
    save({ splitScreenEnabled: !splitEnabled });
  }

  function handleRoleModeChange(mode) {
    setRoleMode(mode);
    localStorage.setItem('carestream_rolemode', mode);
  }

  useEffect(() => {
    hydrateStore();
    setupBroadcastSync();
    prefetchClinicians();
    return () => { stopSync(); stopRealtime(); };
  }, []);

  useEffect(() => {
    if (hydrated && !isPopOut) {
      startSync();
      startRealtime();
    }
  }, [hydrated]);

  useEffect(() => {
    if (hydrated && appUserId) {
      hydrateNotificationsForUser(appUserId);
    }
  }, [hydrated, appUserId]);

  useEffect(() => {
    if (!hydrated || isMobile || !canEnterLead) return;
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
  }, [hydrated, isMobile, canEnterLead]);

  if (!hydrated) return <HydrationScreen />;

  if (isUnassigned) {
    return <WaitingRoom userName={appUserName} />;
  }

  const newReferralModal = showNewReferral && (
    <NewReferralForm
      onClose={() => setShowNewReferral(false)}
      onSuccess={({ patient, referral }) => {
        triggerDataRefresh();
        // Mobile: land on Files so upload is one tap away after create.
        openDrawer(patient, referral, isMobile ? 'files' : undefined);
      }}
    />
  );

  const realtimeToasts = !isPopOut && <RealtimeToasts />;

  // ── Mobile layout ─────────────────────────────────────────────────────────
  if (isMobile) {
    const mobileDivision = division === 'All' ? 'All' : division;
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        maxHeight: '100dvh',
        width: '100%',
        maxWidth: '100%',
        overflow: 'hidden',
        overflowX: 'hidden',
        overscrollBehaviorX: 'none',
        background: palette.backgroundLight.hex,
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}>

        {/* Mobile top bar */}
        <div style={{
          height: 52, flexShrink: 0,
          background: palette.primaryDeepPlum.hex,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 12px 0 14px',
          zIndex: 210,
        }}>
          <img src="/logo-cs.png" alt="CareStream" style={{ height: 26, objectFit: 'contain' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NotificationBell variant="mobile" />
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: hexToRgba(NAV_TEXT, 0.08),
              border: `1px solid ${hexToRgba(NAV_TEXT, 0.15)}`,
              overflow: 'hidden',
            }}>
              <UserButton afterSignOutUrl="/sign-in" />
            </div>
          </div>
        </div>

        <main style={{
          flex: 1,
          minWidth: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehaviorX: 'none',
          touchAction: 'pan-y',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
        }}>
          <Outlet context={{ division: mobileDivision, roleMode }} />
        </main>

        {/* Bottom nav — primary mobile jobs */}
        <nav style={{
          position: 'fixed',
          bottom: 0, left: 0, right: 0,
          background: palette.primaryDeepPlum.hex,
          borderTop: `1px solid ${hexToRgba('#ffffff', 0.1)}`,
          display: 'flex',
          alignItems: 'stretch',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          zIndex: 200,
        }}>
          <MobileNavItem to="/" end label="HOME">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/>
              <path d="M9 21V12h6v9"/>
            </svg>
          </MobileNavItem>

          {(canPatients !== false) && (
            <MobileNavItem to="/patients" label="PATIENTS">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
              </svg>
            </MobileNavItem>
          )}

          {canEnterLead && (
            <button
              type="button"
              onClick={() => setShowNewReferral(true)}
              aria-label="New lead"
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px 0 8px',
                gap: 2,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: '#ffffff',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                borderTop: '2px solid transparent',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span style={{
                width: 48, height: 48, borderRadius: 16, marginTop: -18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: palette.accentGreen.hex,
                color: palette.backgroundLight.hex,
                boxShadow: `0 6px 16px ${hexToRgba(palette.accentGreen.hex, 0.45)}`,
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </span>
              NEW
            </button>
          )}

          {canConflicts && (
            <MobileNavItem to="/modules/conflict" label="CONFLICTS">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </MobileNavItem>
          )}

          {canScheduling && (
            <MobileNavItem to="/modules/soc-completed" label="COMPLETED">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </MobileNavItem>
          )}
        </nav>

        <PatientDrawer />
        {newReferralModal}
        {realtimeToasts}
      </div>
    );
  }

  // ── Pop-out window layout (no sidebar, compact header) ──────────────────────
  if (isPopOut) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: palette.backgroundLight.hex, overflow: 'hidden' }}>
        <header style={{
          height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', background: palette.primaryDeepPlum.hex,
          borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.35)}`, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: hexToRgba(NAV_TEXT_POPOUT, 0.4), background: hexToRgba(NAV_TEXT_POPOUT, 0.08),
              padding: '2px 7px', borderRadius: 4,
            }}>
              POP-OUT
            </span>
            {breadcrumbs.map((crumb, i) => (
              <span key={i} style={{
                color: i === breadcrumbs.length - 1 ? NAV_TEXT_POPOUT : hexToRgba(NAV_TEXT_POPOUT, 0.5),
                fontSize: 13, fontWeight: i === breadcrumbs.length - 1 ? 550 : 400,
              }}>
                {i > 0 && <span style={{ margin: '0 4px', opacity: 0.4 }}>›</span>}
                {crumb}
              </span>
            ))}
          </div>
          <button
            onClick={() => window.close()}
            style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: hexToRgba(NAV_TEXT_POPOUT, 0.1), color: NAV_TEXT_POPOUT,
              fontSize: 11, fontWeight: 600, transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(NAV_TEXT_POPOUT, 0.18))}
            onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(NAV_TEXT_POPOUT, 0.1))}
          >
            Close Window
          </button>
        </header>

        <main style={{ flex: 1, overflow: 'auto', background: palette.backgroundLight.hex }}>
          <Outlet context={{ division: 'All', roleMode }} />
        </main>

        <PatientDrawer />
        {newReferralModal}
        {realtimeToasts}
      </div>
    );
  }

  // ── Desktop layout ─────────────────────────────────────────────────────────
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
      <TopBar
        breadcrumbs={breadcrumbs}
        splitEnabled={splitEnabled}
        onToggleSplit={toggleSplit}
        onPopOut={() => openPopOut(location.pathname)}
      />

      {prefs.subnavEnabled && prefs.pinnedPages.length > 0 && (
        <SubNav pinnedPages={prefs.pinnedPages} onReorder={reorderPins} />
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar division={division} onDivisionChange={setDivision} roleMode={roleMode} onRoleModeChange={handleRoleModeChange} />

        {splitEnabled ? (
          <SplitView division={division} roleMode={roleMode} onClose={toggleSplit}>
            <Outlet context={{ division, roleMode }} />
          </SplitView>
        ) : (
          <main
            style={{
              flex: 1,
              overflow: 'auto',
              background: palette.backgroundLight.hex,
            }}
          >
            <Outlet context={{ division, roleMode }} />
          </main>
        )}
      </div>

      <PatientDrawer />
      {newReferralModal}
      {realtimeToasts}
    </div>
  );
}
