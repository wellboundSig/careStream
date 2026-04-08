import { Panel, Group, Separator } from 'react-resizable-panels';
import { MemoryRouter, Routes, Route, Navigate, Outlet, UNSAFE_LocationContext } from 'react-router-dom';
import PaneNavigation from './PaneNavigation.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

// Clears the parent BrowserRouter context so MemoryRouter can create
// an independent routing tree without the "Router inside Router" error.
function RouterIsolator({ children }) {
  return (
    <UNSAFE_LocationContext.Provider value={null}>
      {children}
    </UNSAFE_LocationContext.Provider>
  );
}

import Dashboard from '../../pages/Dashboard.jsx';
import PipelineBoard from '../../pages/PipelineBoard.jsx';
import PatientList from '../../pages/PatientList.jsx';
import PendingApproval from '../../pages/PendingApproval.jsx';
import ModulePage from '../modules/ModulePage.jsx';
import Tasks from '../../pages/Tasks.jsx';
import Reports from '../../pages/Reports.jsx';
import Marketers from '../../pages/directory/Marketers.jsx';
import Facilities from '../../pages/directory/Facilities.jsx';
import Physicians from '../../pages/directory/Physicians.jsx';
import Campaigns from '../../pages/directory/Campaigns.jsx';
import ReferralSources from '../../pages/directory/ReferralSources.jsx';
import Team from '../../pages/Team.jsx';
import UserManagement from '../../pages/admin/UserManagement.jsx';
import Settings from '../../pages/Settings.jsx';
import DataTools from '../../pages/DataTools.jsx';

function PaneOutlet({ division, roleMode }) {
  return <Outlet context={{ division, roleMode }} />;
}

export default function SplitView({ children, division, roleMode, onClose }) {
  return (
    <Group direction="horizontal" style={{ flex: 1 }}>
      {/* Left pane — main content from BrowserRouter */}
      <Panel defaultSize={50} min={25}>
        <main style={{ height: '100%', overflow: 'auto', background: palette.backgroundLight.hex }}>
          {children}
        </main>
      </Panel>

      {/* Resize handle */}
      <Separator
        style={{
          width: 6,
          background: 'var(--color-border)',
          cursor: 'col-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 3,
            height: 32,
            borderRadius: 2,
            background: hexToRgba(palette.backgroundDark.hex, 0.2),
          }}
        />
      </Separator>

      {/* Right pane — independent MemoryRouter */}
      <Panel defaultSize={50} min={25}>
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: palette.backgroundLight.hex,
          }}
        >
          <RouterIsolator>
            <MemoryRouter initialEntries={['/']}>
              <PaneNavigation onClose={onClose} />
              <div style={{ flex: 1, overflow: 'auto' }}>
                <Routes>
                  <Route element={<PaneOutlet division={division} roleMode={roleMode} />}>
                    <Route index element={<Dashboard />} />
                    <Route path="pipeline" element={<PipelineBoard />} />
                    <Route path="patients" element={<PatientList />} />
                    <Route path="pending" element={<PendingApproval />} />

                    <Route path="modules/lead-entry" element={<ModulePage stage="Lead Entry" />} />
                    <Route path="modules/intake" element={<ModulePage stage="Intake" />} />
                    <Route path="modules/eligibility" element={<ModulePage stage="Eligibility Verification" />} />
                    <Route path="modules/opwdd-enrollment" element={<ModulePage stage="OPWDD Enrollment" />} />
                    <Route path="modules/disenrollment" element={<ModulePage stage="Disenrollment Required" />} />
                    <Route path="modules/f2f" element={<ModulePage stage="F2F/MD Orders Pending" />} />
                    <Route path="modules/clinical-rn" element={<ModulePage stage="Clinical Intake RN Review" />} />
                    <Route path="modules/authorization" element={<ModulePage stage="Authorization Pending" />} />
                    <Route path="modules/conflict" element={<ModulePage stage="Conflict" />} />
                    <Route path="modules/staffing" element={<ModulePage stage="Staffing Feasibility" />} />
                    <Route path="modules/admin-confirmation" element={<ModulePage stage="Admin Confirmation" />} />
                    <Route path="modules/pre-soc" element={<ModulePage stage="Pre-SOC" />} />
                    <Route path="modules/soc-scheduled" element={<Navigate to="/modules/pre-soc" replace />} />
                    <Route path="modules/soc-completed" element={<ModulePage stage="SOC Completed" />} />
                    <Route path="modules/hold" element={<ModulePage stage="Hold" />} />
                    <Route path="modules/ntuc" element={<ModulePage stage="NTUC" />} />

                    <Route path="tasks" element={<Tasks />} />
                    <Route path="reports" element={<Reports />} />

                    <Route path="directory/marketers" element={<Marketers />} />
                    <Route path="directory/facilities" element={<Facilities />} />
                    <Route path="directory/physicians" element={<Physicians />} />
                    <Route path="directory/campaigns" element={<Campaigns />} />
                    <Route path="directory/referral-sources" element={<ReferralSources />} />

                    <Route path="team" element={<Team />} />
                    <Route path="admin/users" element={<UserManagement />} />
                    <Route path="admin/settings" element={<Settings />} />
                    <Route path="admin/data-tools" element={<DataTools />} />
                  </Route>
                </Routes>
              </div>
            </MemoryRouter>
          </RouterIsolator>
        </div>
      </Panel>
    </Group>
  );
}
