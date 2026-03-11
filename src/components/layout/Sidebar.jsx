import { NavLink, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { ROLE_MODES, STAGE_SLUGS } from '../../data/stageConfig.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const NAV_ITEMS = [
  {
    section: null,
    items: [
      { label: 'Dashboard', path: '/', icon: DashboardIcon, exact: true },
      { label: 'Pipeline', path: '/pipeline', icon: PipelineIcon },
    ],
  },
  {
    section: 'DIRECTORY',
    items: [
      { label: 'Patients', path: '/patients', icon: PatientsIcon },
      { label: 'Marketers', path: '/directory/marketers', icon: MarketersIcon },
      { label: 'Facilities', path: '/directory/facilities', icon: FacilitiesIcon },
      { label: 'Physicians', path: '/directory/physicians', icon: PhysiciansIcon },
      { label: 'Campaigns', path: '/directory/campaigns', icon: CampaignsIcon },
      { label: 'Referral Sources', path: '/directory/referral-sources', icon: SourcesIcon },
    ],
  },
  {
    section: 'WORK',
    items: [
      { label: 'Tasks', path: '/tasks', icon: TasksIcon },
      { label: 'Reports', path: '/reports', icon: ReportsIcon },
    ],
  },
  {
    section: 'SYSTEM',
    items: [
      { label: 'Team', path: '/team', icon: UsersIcon },
      { label: 'User Mgmt', path: '/admin/users', icon: ShieldIcon, requiresAdmin: true },
      { label: 'Settings', path: '/admin/settings', icon: SettingsIcon },
    ],
  },
];

const DIVISIONS = ['All', 'ALF', 'Special Needs'];

export default function Sidebar({ division, onDivisionChange, roleMode, onRoleModeChange }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { appUser } = useCurrentAppUser();
  const isAdmin = appUser?.scope === 'DevNurse';

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
          background: hexToRgba(palette.backgroundLight.hex, 0.08),
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: hexToRgba(palette.backgroundLight.hex, 0.5),
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
              return (
                <NavLink key={item.path} to={item.path} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? '9px 0' : '9px 14px', justifyContent: collapsed ? 'center' : 'flex-start', margin: '1px 8px', borderRadius: 8, background: isActive ? hexToRgba(palette.primaryMagenta.hex, 0.2) : 'transparent', color: isActive ? palette.backgroundLight.hex : hexToRgba(palette.backgroundLight.hex, 0.65), fontSize: 13.5, fontWeight: isActive ? 600 : 430, transition: 'all 0.12s', borderLeft: isActive ? `2px solid ${palette.primaryMagenta.hex}` : '2px solid transparent', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden' }} title={collapsed ? item.label : undefined}>
                  <item.icon size={16} color={isActive ? palette.backgroundLight.hex : hexToRgba(palette.backgroundLight.hex, 0.55)} />
                  {!collapsed && item.label}
                </NavLink>
              );
            })}
          </div>
        ))}

        {/* Role-mode module section — after Dashboard/Pipeline */}
        {!collapsed && (
          <RoleModeModules
            roleMode={roleMode}
            onRoleModeChange={onRoleModeChange}
            location={location}
          />
        )}
        {collapsed && (
          <div style={{ margin: '4px 8px 4px', borderTop: `1px solid ${hexToRgba(palette.backgroundLight.hex, 0.08)}` }} />
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
                  color: hexToRgba(palette.backgroundLight.hex, 0.3),
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
                      ? palette.backgroundLight.hex
                      : hexToRgba(palette.backgroundLight.hex, 0.65),
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
                    color={
                      isActive
                        ? palette.backgroundLight.hex
                        : hexToRgba(palette.backgroundLight.hex, 0.55)
                    }
                  />
                  {!collapsed && item.label}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div
          style={{
            padding: '12px 14px',
            borderTop: `1px solid ${hexToRgba(palette.backgroundLight.hex, 0.08)}`,
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: hexToRgba(palette.backgroundLight.hex, 0.3),
              marginBottom: 8,
              textTransform: 'uppercase',
            }}
          >
            Division
          </p>
          <div style={{ display: 'flex', gap: 4 }}>
            {DIVISIONS.map((d) => (
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
                      : hexToRgba(palette.backgroundLight.hex, 0.07),
                  color:
                    division === d
                      ? palette.backgroundLight.hex
                      : hexToRgba(palette.backgroundLight.hex, 0.5),
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                }}
              >
                {d === 'Special Needs' ? 'SN' : d}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

// ── Role Mode Module Nav ──────────────────────────────────────────────────────
function RoleModeModules({ roleMode, onRoleModeChange, location }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropRef = useRef(null);

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
    <div style={{ margin: '4px 8px 2px', paddingBottom: 4, borderBottom: `1px solid ${hexToRgba(palette.backgroundLight.hex, 0.08)}` }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundLight.hex, 0.3), padding: '10px 6px 6px' }}>
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
          <span style={{ fontSize: 12.5, fontWeight: 700, color: palette.backgroundLight.hex, flex: 1 }}>{currentMode.label}</span>
          <button
            onClick={(e) => { e.stopPropagation(); setDropdownOpen((o) => !o); }}
            title="Select mode"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: hexToRgba(palette.backgroundLight.hex, 0.6),
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
            border: `1px solid ${hexToRgba(palette.backgroundLight.hex, 0.15)}`,
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
                <span style={{ fontSize: 12.5, fontWeight: mode.id === roleMode ? 700 : 450, color: palette.backgroundLight.hex }}>{mode.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: hexToRgba(palette.backgroundLight.hex, 0.35) }}>{mode.stages.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Module links */}
      {currentMode.stages.map((stage) => {
        const slug = STAGE_SLUGS[stage];
        if (!slug) return null;
        const path = `/modules/${slug}`;
        const isActive = location.pathname === path;
        return (
          <NavLink
            key={stage}
            to={path}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', margin: '1px 0', borderRadius: 7,
              background: isActive ? hexToRgba(palette.primaryMagenta.hex, 0.2) : 'transparent',
              color: isActive ? palette.backgroundLight.hex : hexToRgba(palette.backgroundLight.hex, 0.6),
              fontSize: 12.5, fontWeight: isActive ? 600 : 400,
              borderLeft: `2px solid ${isActive ? palette.primaryMagenta.hex : 'transparent'}`,
              textDecoration: 'none', transition: 'all 0.12s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
            title={stage}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: isActive ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundLight.hex, 0.35), display: 'inline-block', flexShrink: 0 }} />
            {stage}
          </NavLink>
        );
      })}
    </div>
  );
}

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
