import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import AccessDenied from '../../components/common/AccessDenied.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

export const CONFIGURATION_TABS = [
  { to: 'leads', label: 'Lead viability', perm: PERMISSION_KEYS.ADMIN_SETTINGS },
  { to: 'permissions', label: 'Permissions', perm: PERMISSION_KEYS.ADMIN_PERMISSIONS },
  { to: 'conflict-categories', label: 'Conflict Categories', perm: PERMISSION_KEYS.CONFLICT_MANAGE_CATEGORIES },
  { to: 'departments', label: 'Departments', perm: PERMISSION_KEYS.ADMIN_DEPARTMENTS },
];

export function ConfigurationIndex() {
  const { can } = usePermissions();
  const first = CONFIGURATION_TABS.find((tab) => can(tab.perm));
  if (!first) {
    return <AccessDenied message="You do not have permission to open Global Configuration." />;
  }
  return <Navigate to={first.to} replace />;
}

export default function GlobalConfiguration() {
  const { can } = usePermissions();
  const visible = CONFIGURATION_TABS.filter((tab) => can(tab.perm));

  if (visible.length === 0) {
    return <AccessDenied message="You do not have permission to open Global Configuration." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: '18px 28px 0',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
          background: palette.backgroundLight.hex,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 750, color: palette.backgroundDark.hex, margin: 0 }}>
          Global Configuration
        </h1>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '6px 0 0', maxWidth: 640 }}>
          Org-wide settings. Each section uses its existing permission.
        </p>
        <nav
          aria-label="Configuration sections"
          style={{ display: 'flex', gap: 4, marginTop: 14, overflowX: 'auto' }}
        >
          {visible.map((tab) => (
            <NavLink
              key={tab.to}
              to={`/admin/configuration/${tab.to}`}
              style={({ isActive }) => ({
                padding: '8px 14px 10px',
                fontSize: 13,
                fontWeight: isActive ? 650 : 500,
                color: isActive ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
                textDecoration: 'none',
                borderBottom: `2px solid ${isActive ? palette.primaryMagenta.hex : 'transparent'}`,
                whiteSpace: 'nowrap',
              })}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Outlet />
      </div>
    </div>
  );
}
