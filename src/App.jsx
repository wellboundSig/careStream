import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@clerk/react';

import AppShell from './components/layout/AppShell.jsx';
import LoadingState from './components/common/LoadingState.jsx';
import ModulePage from './components/modules/ModulePage.jsx';

import Dashboard from './pages/Dashboard.jsx';
import PatientList from './pages/PatientList.jsx';
import PipelineBoard from './pages/PipelineBoard.jsx';
import PendingApproval from './pages/PendingApproval.jsx';
import Team from './pages/Team.jsx';
import Marketers from './pages/directory/Marketers.jsx';
import Tasks from './pages/Tasks.jsx';
import UserManagement from './pages/admin/UserManagement.jsx';
import SignInPage from './pages/auth/SignIn.jsx';
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

      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="pipeline" element={<PipelineBoard />} />
        <Route path="patients" element={<PatientList />} />
        <Route path="pending" element={<PendingApproval />} />
        {/* Module routes — all 15 pipeline stages */}
        <Route path="modules/lead-entry"          element={<ModulePage stage="Lead Entry" />} />
        <Route path="modules/intake"              element={<ModulePage stage="Intake" />} />
        <Route path="modules/eligibility"         element={<ModulePage stage="Eligibility Verification" />} />
        <Route path="modules/disenrollment"       element={<ModulePage stage="Disenrollment Required" />} />
        <Route path="modules/f2f"                 element={<ModulePage stage="F2F/MD Orders Pending" />} />
        <Route path="modules/clinical-rn"         element={<ModulePage stage="Clinical Intake RN Review" />} />
        <Route path="modules/authorization"       element={<ModulePage stage="Authorization Pending" />} />
        <Route path="modules/conflict"            element={<ModulePage stage="Conflict" />} />
        <Route path="modules/staffing"            element={<ModulePage stage="Staffing Feasibility" />} />
        <Route path="modules/admin-confirmation"  element={<ModulePage stage="Admin Confirmation" />} />
        <Route path="modules/pre-soc"             element={<ModulePage stage="Pre-SOC" />} />
        <Route path="modules/soc-scheduled"       element={<ModulePage stage="SOC Scheduled" />} />
        <Route path="modules/soc-completed"       element={<ModulePage stage="SOC Completed" />} />
        <Route path="modules/hold"                element={<ModulePage stage="Hold" />} />
        <Route path="modules/ntuc"                element={<ModulePage stage="NTUC" />} />

        <Route path="tasks" element={<Tasks />} />
        <Route path="reports" element={<ComingSoon title="Reports" />} />
        <Route path="directory/marketers" element={<Marketers />} />
        <Route path="directory/facilities" element={<ComingSoon title="Facilities Directory" />} />
        <Route path="directory/physicians" element={<ComingSoon title="Physicians Directory" />} />
        <Route path="directory/campaigns" element={<ComingSoon title="Campaigns" />} />
        <Route path="directory/referral-sources" element={<ComingSoon title="Referral Sources" />} />
        <Route path="team" element={<Team />} />
        <Route path="admin/users" element={<UserManagement />} />
        <Route path="admin/settings" element={<ComingSoon title="Settings" />} />
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
