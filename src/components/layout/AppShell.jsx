import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import PatientDrawer from '../patient/PatientDrawer.jsx';
import { SLUG_TO_STAGE } from '../../data/stageConfig.js';
import palette from '../../utils/colors.js';
import { useTheme } from '../../utils/ThemeContext.jsx';

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
  };
  if (pathname.startsWith('/modules/')) {
    const slug = pathname.replace('/modules/', '');
    const stage = SLUG_TO_STAGE[slug];
    return stage ? ['Modules', stage] : ['Modules'];
  }
  return map[pathname] || [pathname.replace('/', '').replace(/-/g, ' ')];
}

export default function AppShell() {
  // Subscribe to theme — causes full Outlet re-render when theme toggles,
  // which makes all inline palette.*.hex reads pick up the new values.
  useTheme();

  const [division, setDivision] = useState('All');
  const [roleMode, setRoleMode] = useState(() => localStorage.getItem('carestream_rolemode') || 'intake');
  const location = useLocation();
  const breadcrumbs = getBreadcrumbs(location.pathname);

  function handleRoleModeChange(mode) {
    setRoleMode(mode);
    localStorage.setItem('carestream_rolemode', mode);
  }

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
    </div>
  );
}
