import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@clerk/react';
import { DirectoryDrawerProvider } from './context/DirectoryDrawerContext.jsx';

import AppShell from './components/layout/AppShell.jsx';
import LoadingState from './components/common/LoadingState.jsx';
import ModulePage from './components/modules/ModulePage.jsx';

import Dashboard from './pages/Dashboard.jsx';
import PatientList from './pages/PatientList.jsx';
import PipelineBoard from './pages/PipelineBoard.jsx';
import PendingApproval from './pages/PendingApproval.jsx';
import Team from './pages/Team.jsx';
import Marketers from './pages/directory/Marketers.jsx';
import Facilities from './pages/directory/Facilities.jsx';
import Physicians from './pages/directory/Physicians.jsx';
import Campaigns from './pages/directory/Campaigns.jsx';
import ReferralSources from './pages/directory/ReferralSources.jsx';
import Clinicians from './pages/directory/Clinicians.jsx';
import Tasks from './pages/Tasks.jsx';
import UserManagement from './pages/admin/UserManagement.jsx';
import Settings from './pages/Settings.jsx';
import CalendarPage from './pages/Calendar.jsx';
import Reports from './pages/Reports.jsx';
import DataTools from './pages/DataTools.jsx';
import Permissions from './pages/admin/Permissions.jsx';
import DepartmentManagement from './pages/admin/DepartmentManagement.jsx';
import DepartmentDashboardPage from './pages/DepartmentDashboardPage.jsx';
import SignInPage from './pages/auth/SignIn.jsx';
import Training from './pages/Training.jsx';
import NotFound from './pages/NotFound.jsx';

function RequireAuth({ children }) {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return <LoadingState message="Authenticating..." />;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign-in/*" element={<SignInPage />} />

      {/* Training — standalone, no AppShell nav */}
      <Route path="/training" element={<RequireAuth><Training /></RequireAuth>} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <DirectoryDrawerProvider>
              <AppShell />
            </DirectoryDrawerProvider>
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="department/:deptId" element={<DepartmentDashboardPage />} />
        <Route path="pipeline" element={<PipelineBoard />} />
        <Route path="patients" element={<PatientList />} />
        <Route path="pending" element={<PendingApproval />} />
        {/* Module routes — all 15 pipeline stages */}
        <Route path="modules/lead-entry"          element={<ModulePage stage="Lead Entry" />} />
        <Route path="modules/discarded-leads"    element={<ModulePage stage="Discarded Leads" />} />
        <Route path="modules/intake"              element={<ModulePage stage="Intake" />} />
        <Route path="modules/eligibility"         element={<ModulePage stage="Eligibility Verification" />} />
        <Route path="modules/opwdd-enrollment"    element={<ModulePage stage="OPWDD Enrollment" />} />
        <Route path="modules/disenrollment"       element={<ModulePage stage="Disenrollment Required" />} />
        <Route path="modules/f2f"                 element={<ModulePage stage="F2F/MD Orders Pending" />} />
        <Route path="modules/clinical-rn"         element={<ModulePage stage="Clinical Intake RN Review" />} />
        <Route path="modules/authorization"       element={<ModulePage stage="Authorization Pending" />} />
        <Route path="modules/conflict"            element={<ModulePage stage="Conflict" />} />
        <Route path="modules/staffing"            element={<ModulePage stage="Staffing Feasibility" />} />
        <Route path="modules/admin-confirmation"  element={<ModulePage stage="Admin Confirmation" />} />
        <Route path="modules/pre-soc"             element={<ModulePage stage="Pre-SOC" />} />
        <Route path="modules/soc-scheduled"       element={<Navigate to="/modules/pre-soc" replace />} />
        <Route path="modules/soc-completed"       element={<ModulePage stage="SOC Completed" />} />
        <Route path="modules/hold"                element={<ModulePage stage="Hold" />} />
        <Route path="modules/ntuc"                element={<ModulePage stage="NTUC" />} />

        <Route path="tasks" element={<Tasks />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="reports" element={<Reports />} />
        <Route path="directory/marketers" element={<Marketers />} />
        <Route path="directory/facilities" element={<Facilities />} />
        <Route path="directory/physicians" element={<Physicians />} />
        <Route path="directory/campaigns" element={<Campaigns />} />
        <Route path="directory/referral-sources" element={<ReferralSources />} />
        <Route path="directory/clinicians" element={<Clinicians />} />
        <Route path="team" element={<Team />} />
        <Route path="admin/users" element={<UserManagement />} />
        <Route path="admin/permissions" element={<Permissions />} />
        <Route path="admin/departments" element={<DepartmentManagement />} />
        <Route path="admin/settings" element={<Settings />} />
        <Route path="admin/data-tools" element={<DataTools />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function ComingSoon({ title }) {
  return (
    <NotFound />
  );
}
