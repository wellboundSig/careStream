import { NavLink, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect, useMemo } from 'react';
import { ROLE_MODES, STAGE_SLUGS, STAGE_META } from '../../data/stageConfig.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { usePreferences } from '../../context/UserPreferencesContext.jsx';
import { useCareStore } from '../../store/careStore.js';
import palette, { hexToRgba } from '../../utils/colors.js';

// The sidebar is always the brand plum color — its text/icons must always be
// near-white regardless of the page theme. Never use palette.backgroundLight
// here because that token inverts in dark mode.
const NAV_TEXT = '#F7F7FA';

const NAV_ITEMS = [
  {
    section: null,
    items: [
      { label: 'Dashboard', path: '/', icon: DashboardIcon, exact: true },
      { label: 'Tasks', path: '/tasks', icon: TasksIcon },
      { label: 'Pipeline', path: '/pipeline', icon: PipelineIcon },
      { label: 'Patients', path: '/patients', icon: PatientsIcon },
    ],
  },
  {
    section: 'DIRECTORY',
    items: [
      { label: 'Marketers', path: '/directory/marketers', icon: MarketersIcon },
      { label: 'Facilities', path: '/directory/facilities', icon: FacilitiesIcon },
      { label: 'Physicians', path: '/directory/physicians', icon: PhysiciansIcon },
      { label: 'Referral Sources', path: '/directory/referral-sources', icon: SourcesIcon },
      { label: 'Clinicians', path: '/directory/clinicians', icon: PhysiciansIcon },
      { label: 'Campaigns', path: '/directory/campaigns', icon: CampaignsIcon },
    ],
  },
  {
    section: 'WORK',
    items: [
      { label: 'Calendar', path: '/calendar', icon: CalendarIcon },
      { label: 'Reports', path: '/reports', icon: ReportsIcon },
    ],
  },
  {
    section: 'SYSTEM',
    items: [
      { label: 'Team', path: '/team', icon: UsersIcon },
      { label: 'User Mgmt', path: '/admin/users', icon: ShieldIcon, requiresAdmin: true },
      { label: 'Permissions', path: '/admin/permissions', icon: PermissionsIcon, requiresAdmin: true },
      { label: 'Departments', path: '/admin/departments', icon: DepartmentsIcon, requiresAdmin: true },
      { label: 'Data Tools', path: '/admin/data-tools', icon: DataToolsIcon, requiresAdmin: true },
      { label: 'Settings', path: '/admin/settings', icon: SettingsIcon },
    ],
  },
];

const DIVISIONS = ['All', 'ALF', 'Special Needs'];

export default function Sidebar({ division, onDivisionChange, roleMode, onRoleModeChange }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { appUser } = useCurrentAppUser();
  const { prefs, pinPage, unpinPage, MAX_PINS } = usePreferences();
  const { can, hasDivision } = usePermissions();
  const isAdmin = can(PERMISSION_KEYS.ADMIN_USER_MANAGEMENT) || can(PERMISSION_KEYS.ADMIN_PERMISSIONS) || can(PERMISSION_KEYS.ADMIN_DATA_TOOLS);

  const storeDepts = useCareStore((s) => s.departments);
  const appUserId = appUser?.id;
  const supervisedDepts = useMemo(() => {
    if (!appUserId) return [];
    return Object.values(storeDepts || {}).filter((d) => d.supervisor === appUserId);
  }, [storeDepts, appUserId]);

  const allowedDivisions = useMemo(() => {
    const divs = [];
    if (hasDivision('ALF')) divs.push('ALF');
    if (hasDivision('Special Needs')) divs.push('Special Needs');
    if (divs.length === 2) return ['All', 'ALF', 'Special Needs'];
    if (divs.length === 1) return divs;
    return ['All', 'ALF', 'Special Needs'];
  }, [hasDivision]);

  // Right-click pin menu
  const [pinMenu, setPinMenu] = useState(null); // { x, y, path, label }

  function handleNavContextMenu(e, path, label) {
    e.preventDefault();
    e.stopPropagation();
    setPinMenu({ x: e.clientX, y: e.clientY, path, label });
  }

  const sidebarWidth = collapsed ? 60 : 220;

  return (
    <aside
      style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        height: '100%',
        background: palette.primaryDeepPlum.hex,
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          position: 'absolute',
          top: 12,
          right: collapsed ? '50%' : 10,
          transform: collapsed ? 'translateX(50%)' : 'none',
          width: 22,
          height: 22,
          borderRadius: 6,
          background: hexToRgba(NAV_TEXT, 0.08),
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: hexToRgba(NAV_TEXT, 0.5),
          cursor: 'pointer',
          zIndex: 10,
          flexShrink: 0,
          transition: 'all 0.2s',
        }}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
        >
          <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <nav
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '50px 0 8px',
        }}
      >
        {/* First group (Dashboard + Pipeline) renders before Modules */}
        {NAV_ITEMS.slice(0, 1).map((group, gi) => (
          <div key={`top-${gi}`} style={{ marginBottom: 4 }}>
            {group.items.filter((item) => !item.requiresAdmin || isAdmin).map((item) => {
              const isActive = item.exact
                ? location.pathname === item.path
                : location.pathname.startsWith(item.path) && item.path !== '/';
              const navLink = (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onContextMenu={(e) => handleNavContextMenu(e, item.path, item.label)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? '9px 0' : '9px 14px', justifyContent: collapsed ? 'center' : 'flex-start', margin: '1px 8px', borderRadius: 8, background: isActive ? hexToRgba(palette.primaryMagenta.hex, 0.2) : 'transparent', color: isActive ? NAV_TEXT : hexToRgba(NAV_TEXT, 0.65), fontSize: 13.5, fontWeight: isActive ? 600 : 430, transition: 'all 0.12s', borderLeft: isActive ? `2px solid ${palette.primaryMagenta.hex}` : '2px solid transparent', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden' }}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon size={16} color={isActive ? NAV_TEXT : hexToRgba(NAV_TEXT, 0.55)} />
                  {!collapsed && item.label}
                </NavLink>
              );

              // Department sub-links directly under Dashboard
              if (item.path === '/' && !collapsed && supervisedDepts.length > 0) {
                return (
                  <div key={item.path}>
                    {navLink}
                    {supervisedDepts.map((dept) => {
                      const dPath = `/department/${dept.id}`;
                      const dActive = location.pathname === dPath;
                      return (
                        <NavLink key={dept.id} to={dPath} style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          padding: '5px 14px 5px 30px', margin: '0 8px', borderRadius: 7,
                          background: dActive ? hexToRgba(palette.primaryMagenta.hex, 0.2) : 'transparent',
                          color: dActive ? NAV_TEXT : hexToRgba(NAV_TEXT, 0.48),
                          fontSize: 12, fontWeight: dActive ? 600 : 400,
                          borderLeft: `2px solid ${dActive ? palette.primaryMagenta.hex : 'transparent'}`,
                          textDecoration: 'none', transition: 'all 0.12s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          <DashboardIcon size={11} color={dActive ? NAV_TEXT : hexToRgba(NAV_TEXT, 0.35)} />
                          {dept.name}
                        </NavLink>
                      );
                    })}
                  </div>
                );
              }

              return navLink;
            })}
          </div>
        ))}

        {/* Role-mode module section — after Dashboard/Pipeline */}
        {!collapsed && (
          <RoleModeModules
            roleMode={roleMode}
            onRoleModeChange={onRoleModeChange}
            location={location}
            onContextMenu={handleNavContextMenu}
          />
        )}
        {collapsed && (
          <div style={{ margin: '4px 8px 4px', borderTop: `1px solid ${hexToRgba(NAV_TEXT, 0.08)}` }} />
        )}

        {/* Remaining groups (Directory, Work, System) */}
        {NAV_ITEMS.slice(1).map((group, gi) => (
          <div key={gi} style={{ marginBottom: 4 }}>
            {group.section && !collapsed && (
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: hexToRgba(NAV_TEXT, 0.3),
                  padding: '12px 16px 4px',
                  textTransform: 'uppercase',
                }}
              >
                {group.section}
              </p>
            )}
            {group.items.filter((item) => !item.requiresAdmin || isAdmin).map((item) => {
              const isActive = item.exact
                ? location.pathname === item.path
                : location.pathname.startsWith(item.path) && item.path !== '/';

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onContextMenu={(e) => handleNavContextMenu(e, item.path, item.label)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: collapsed ? '9px 0' : '9px 14px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    margin: '1px 8px',
                    borderRadius: 8,
                    background: isActive
                      ? hexToRgba(palette.primaryMagenta.hex, 0.2)
                      : 'transparent',
                    color: isActive
                      ? NAV_TEXT
                      : hexToRgba(NAV_TEXT, 0.65),
                    fontSize: 13.5,
                    fontWeight: isActive ? 600 : 430,
                    transition: 'all 0.12s',
                    borderLeft: isActive
                      ? `2px solid ${palette.primaryMagenta.hex}`
                      : '2px solid transparent',
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                  }}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon
                    size={16}
                    color={isActive ? NAV_TEXT : hexToRgba(NAV_TEXT, 0.55)}
                  />
                  {!collapsed && item.label}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {pinMenu && (
        <PinContextMenu
          x={pinMenu.x}
          y={pinMenu.y}
          path={pinMenu.path}
          label={pinMenu.label}
          isPinned={prefs.pinnedPages.includes(pinMenu.path)}
          atLimit={!prefs.pinnedPages.includes(pinMenu.path) && prefs.pinnedPages.length >= MAX_PINS}
          onPin={() => pinPage(pinMenu.path)}
          onUnpin={() => unpinPage(pinMenu.path)}
          onDismiss={() => setPinMenu(null)}
        />
      )}

      {!collapsed && (
        <div
          style={{
            padding: '12px 14px',
            borderTop: `1px solid ${hexToRgba(NAV_TEXT, 0.08)}`,
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: hexToRgba(NAV_TEXT, 0.3),
              marginBottom: 8,
              textTransform: 'uppercase',
            }}
          >
            Division
          </p>
          <div style={{ display: 'flex', gap: 4 }}>
            {allowedDivisions.map((d) => (
              <button
                key={d}
                onClick={() => onDivisionChange?.(d)}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  background:
                    division === d
                      ? palette.primaryMagenta.hex
                      : hexToRgba(NAV_TEXT, 0.07),
                  color:
                    division === d
                      ? NAV_TEXT
                      : hexToRgba(NAV_TEXT, 0.5),
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                }}
              >
                {d === 'Special Needs' ? 'SPN' : d}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

// ── Role Mode Module Nav ──────────────────────────────────────────────────────
const STAGE_TO_MODULE_PERM = {
  'Lead Entry': PERMISSION_KEYS.MODULE_INTAKE,
  'Discarded Leads': PERMISSION_KEYS.MODULE_INTAKE,
  'OPWDD Enrollment': PERMISSION_KEYS.MODULE_INTAKE,
  'Intake': PERMISSION_KEYS.MODULE_INTAKE,
  'Eligibility Verification': PERMISSION_KEYS.MODULE_INTAKE,
  'Disenrollment Required': PERMISSION_KEYS.MODULE_INTAKE,
  'F2F/MD Orders Pending': PERMISSION_KEYS.MODULE_INTAKE,
  'Clinical Intake RN Review': PERMISSION_KEYS.MODULE_CLINICAL,
  'Conflict': PERMISSION_KEYS.MODULE_CLINICAL,
  'Authorization Pending': PERMISSION_KEYS.MODULE_AUTHORIZATION,
  'Staffing Feasibility': PERMISSION_KEYS.MODULE_SCHEDULING,
  'Pre-SOC': PERMISSION_KEYS.MODULE_SCHEDULING,
  'SOC Scheduled': PERMISSION_KEYS.MODULE_SCHEDULING,
  'SOC Completed': PERMISSION_KEYS.MODULE_SCHEDULING,
  'Admin Confirmation': PERMISSION_KEYS.MODULE_ADMIN,
  'Hold': PERMISSION_KEYS.MODULE_ADMIN,
  'NTUC': PERMISSION_KEYS.MODULE_ADMIN,
};

function RoleModeModules({ roleMode, onRoleModeChange, location, onContextMenu }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropRef = useRef(null);
  const { can: canPerm } = usePermissions();

  const currentMode = ROLE_MODES.find((m) => m.id === roleMode) || ROLE_MODES[0];

  function cycleMode() {
    const idx = ROLE_MODES.findIndex((m) => m.id === roleMode);
    const next = ROLE_MODES[(idx + 1) % ROLE_MODES.length];
    onRoleModeChange(next.id);
  }

  useEffect(() => {
    if (!dropdownOpen) return;
    function onClick(e) {
      if (!dropRef.current?.contains(e.target)) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [dropdownOpen]);

  return (
    <div style={{ margin: '4px 8px 2px', paddingBottom: 4, borderBottom: `1px solid ${hexToRgba(NAV_TEXT, 0.08)}` }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(NAV_TEXT, 0.3), padding: '10px 6px 6px' }}>
        Modules
      </p>

      {/* Role mode pill */}
      <div ref={dropRef} style={{ position: 'relative', marginBottom: 6 }}>
        <div
          onClick={cycleMode}
          title="Click to cycle mode — use arrow to pick"
          style={{
            borderRadius: 8, background: hexToRgba(currentMode.color, 0.22),
            padding: '8px 12px', cursor: 'pointer', position: 'relative',
            display: 'flex', alignItems: 'center', gap: 8,
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(currentMode.color, 0.32))}
          onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(currentMode.color, 0.22))}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: currentMode.color, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: NAV_TEXT, flex: 1 }}>{currentMode.label}</span>
          <button
            onClick={(e) => { e.stopPropagation(); setDropdownOpen((o) => !o); }}
            title="Select mode"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: hexToRgba(NAV_TEXT, 0.6),
              display: 'flex', alignItems: 'center',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {dropdownOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: palette.primaryDeepPlum.hex,
            border: `1px solid ${hexToRgba(NAV_TEXT, 0.15)}`,
            borderRadius: 9, overflow: 'hidden', zIndex: 200,
            boxShadow: `0 8px 24px ${hexToRgba(palette.backgroundDark.hex, 0.4)}`,
          }}>
            {ROLE_MODES.map((mode) => (
              <button
                key={mode.id}
                onClick={() => { onRoleModeChange(mode.id); setDropdownOpen(false); }}
                style={{
                  width: '100%', padding: '8px 12px', background: mode.id === roleMode ? hexToRgba(mode.color, 0.2) : 'none',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => { if (mode.id !== roleMode) e.currentTarget.style.background = hexToRgba(mode.color, 0.1); }}
                onMouseLeave={(e) => { if (mode.id !== roleMode) e.currentTarget.style.background = 'none'; }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: mode.color, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, fontWeight: mode.id === roleMode ? 700 : 450, color: NAV_TEXT }}>{mode.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: hexToRgba(NAV_TEXT, 0.35) }}>{mode.stages.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Module links — filtered by permission and hiddenFromNav */}
      {currentMode.stages.map((stage) => {
        const slug = STAGE_SLUGS[stage];
        if (!slug) return null;
        if (STAGE_META[stage]?.hiddenFromNav) return null;
        const requiredPerm = STAGE_TO_MODULE_PERM[stage];
        if (requiredPerm && !canPerm(requiredPerm)) return null;
        const path = `/modules/${slug}`;
        const isActive = location.pathname === path;
        return (
          <NavLink
            key={stage}
            to={path}
            onContextMenu={(e) => onContextMenu?.(e, path, stage)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', margin: '1px 0', borderRadius: 7,
              background: isActive ? hexToRgba(palette.primaryMagenta.hex, 0.2) : 'transparent',
              color: isActive ? NAV_TEXT : hexToRgba(NAV_TEXT, 0.6),
              fontSize: 12.5, fontWeight: isActive ? 600 : 400,
              borderLeft: `2px solid ${isActive ? palette.primaryMagenta.hex : 'transparent'}`,
              textDecoration: 'none', transition: 'all 0.12s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
            title={stage}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: isActive ? palette.primaryMagenta.hex : hexToRgba(NAV_TEXT, 0.35), display: 'inline-block', flexShrink: 0 }} />
            {STAGE_META[stage]?.displayName || stage}
          </NavLink>
        );
      })}
    </div>
  );
}

// ── Pin context menu ──────────────────────────────────────────────────────────
function PinContextMenu({ x, y, path, label, isPinned, atLimit, onPin, onUnpin, onDismiss }) {
  const ref = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onDismiss(); }
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) onDismiss(); }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onDismiss]);

  // Smart-position so the menu doesn't overflow the viewport
  const menuWidth  = 224;
  const menuHeight = 90;
  const left = Math.min(x + 8, window.innerWidth  - menuWidth  - 8);
  const top  = Math.min(y,      window.innerHeight - menuHeight - 8);

  const menuItem = (children, onClick, disabled) => (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        width: '100%', padding: '8px 14px', background: 'none', border: 'none',
        textAlign: 'left', cursor: disabled ? 'default' : 'pointer',
        fontSize: 13, fontWeight: 480, color: disabled
          ? hexToRgba(palette.backgroundDark.hex, 0.3)
          : palette.backgroundDark.hex,
        display: 'flex', alignItems: 'center', gap: 9, transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.05); }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
    >
      {children}
    </button>
  );

  return (
    <>
      <div onClick={onDismiss} style={{ position: 'fixed', inset: 0, zIndex: 9990 }} />
      <div
        ref={ref}
        style={{
          position: 'fixed', top, left, zIndex: 9991,
          background: palette.backgroundLight.hex,
          border: `1px solid var(--color-border)`,
          borderRadius: 10, overflow: 'hidden', minWidth: menuWidth,
          boxShadow: `0 8px 28px ${hexToRgba(palette.backgroundDark.hex, 0.14)}`,
        }}
      >
        <div style={{ padding: '8px 14px 7px', borderBottom: `1px solid var(--color-border)` }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>
            {label}
          </p>
        </div>
        <div style={{ padding: '4px 0' }}>
          {isPinned
            ? menuItem(<><PinOffIcon />Remove from navigation bar</>, () => { onUnpin(); onDismiss(); })
            : menuItem(
                <><PinIcon />{atLimit ? 'Pin bar full (max 6)' : 'Pin to navigation bar'}</>,
                () => { onPin(); onDismiss(); },
                atLimit,
              )
          }
        </div>
      </div>
    </>
  );
}

const PinIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <path d="M12 2l3 7h5l-4 4 2 7-6-4-6 4 2-7-4-4h5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
);

const PinOffIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <path d="M12 2l3 7h5l-4 4 2 7-6-4-6 4 2-7-4-4h5zM2 2l20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ── Nav icons ─────────────────────────────────────────────────────────────────
function DashboardIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke={color} strokeWidth="1.6" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke={color} strokeWidth="1.6" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke={color} strokeWidth="1.6" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function PipelineIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 6h4v12H3zM10 6h4v12h-4zM17 6h4v12h-4z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function PatientsIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="7" r="4" stroke={color} strokeWidth="1.6" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function MarketersIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FacilitiesIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 21h18M5 21V7l7-4 7 4v14" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="9" y="14" width="6" height="7" rx="1" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function PhysiciansIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 22v-4M8 18H6a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-2" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="22" r="2" stroke={color} strokeWidth="1.6" />
      <path d="M9 11h6M12 8v6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CampaignsIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 3l14 9-14 9V3z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function SourcesIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="2" stroke={color} strokeWidth="1.6" />
      <circle cx="5" cy="7" r="2" stroke={color} strokeWidth="1.6" />
      <circle cx="19" cy="7" r="2" stroke={color} strokeWidth="1.6" />
      <circle cx="5" cy="17" r="2" stroke={color} strokeWidth="1.6" />
      <circle cx="19" cy="17" r="2" stroke={color} strokeWidth="1.6" />
      <path d="M7 8l3 3M14 13l3 3M14 11l3-3M7 16l3-3" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function TasksIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 11l3 3L22 4" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="18" rx="2" stroke={color} strokeWidth="1.6" />
      <path d="M16 2v4M8 2v4M3 10h18" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ReportsIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M18 20V10M12 20V4M6 20v-6" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UsersIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="7" r="4" stroke={color} strokeWidth="1.6" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ShieldIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9 12l2 2 4-4" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function PermissionsIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 11l3 3L22 4" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function DepartmentsIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="5" rx="1.5" stroke={color} strokeWidth="1.6" />
      <rect x="3" y="12" width="8" height="5" rx="1.5" stroke={color} strokeWidth="1.6" />
      <rect x="13" y="12" width="8" height="5" rx="1.5" stroke={color} strokeWidth="1.6" />
      <path d="M12 8v4M7 12v0M17 12v0" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function DataToolsIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <ellipse cx="12" cy="6" rx="8" ry="3" stroke={color} strokeWidth="1.6" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" stroke={color} strokeWidth="1.6" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function SettingsIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.6" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke={color}
        strokeWidth="1.6"
      />
    </svg>
  );
}
