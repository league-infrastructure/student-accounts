import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import AppLayout from './components/AppLayout';
import AdminOnlyRoute from './components/AdminOnlyRoute';
import Login from './pages/Login';

import About from './pages/About';
import McpSetup from './pages/McpSetup';
import NotFound from './pages/NotFound';
import Account from './pages/Account';
import Onboarding from './pages/Onboarding';

import AdminLogin from './pages/admin/AdminLogin';
import AdminLayout from './pages/admin/AdminLayout';
import AuditLogPanel from './pages/admin/AuditLogPanel';
import EnvironmentInfo from './pages/admin/EnvironmentInfo';
import DatabaseViewer from './pages/admin/DatabaseViewer';
import ConfigPanel from './pages/admin/ConfigPanel';
import LogViewer from './pages/admin/LogViewer';
import SessionViewer from './pages/admin/SessionViewer';
import ScheduledJobsPanel from './pages/admin/ScheduledJobsPanel';
import ImportExport from './pages/admin/ImportExport';
import UserDetailPanel from './pages/admin/UserDetailPanel';
import StudentAccountsPanel from './pages/admin/StudentAccountsPanel';
import LlmProxyUsersPanel from './pages/admin/LlmProxyUsersPanel';
import AdminUsersPanel from './pages/admin/AdminUsersPanel';
import Cohorts from './pages/admin/Cohorts';
import CohortDetailPanel from './pages/admin/CohortDetailPanel';
import Groups from './pages/admin/Groups';
import GroupDetailPanel from './pages/admin/GroupDetailPanel';
import SyncPanel from './pages/admin/SyncPanel';
import MergeQueuePanel from './pages/admin/MergeQueuePanel';
import Dashboard from './pages/admin/Dashboard';
import OAuthClients from './pages/OAuthClients';
import ClaudeCode from './pages/ClaudeCode';
import LlmProxy from './pages/LlmProxy';

import OAuthConsent from './pages/OAuthConsent';

import StaffLayout from './pages/staff/StaffLayout';
import StaffDirectory from './pages/staff/StaffDirectory';

const queryClient = new QueryClient();

function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  // Signed-in user who hasn't completed the one-time name-setup step: show
  // only the Onboarding page. Everyone else (signed-out, loading, or
  // onboarded) sees the normal routes.
  if (!loading && user && user.onboardingCompleted === false) {
    return <Onboarding />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
          <OnboardingGate>
          <Routes>
            {/* Standalone pages (no AppLayout) */}
            <Route path="/login" element={<Login />} />

            {/* OAuth consent screen — public, no AppLayout, no auth gate.
                Authentication for this flow is handled upstream at /oauth/authorize. */}
            <Route path="/oauth/consent" element={<OAuthConsent />} />

            {/* Admin login (standalone, no layout) */}
            <Route path="/admin" element={<AdminLogin />} />

            {/* All authenticated routes share AppLayout (sidebar + topbar) */}
            <Route element={<AppLayout />}>
              <Route path="/about" element={<About />} />
              <Route path="/account" element={<Account />} />
              <Route path="/mcp-setup" element={<McpSetup />} />
              <Route path="/oauth-clients" element={<OAuthClients />} />
              <Route path="/claude-code" element={<ClaudeCode />} />
              <Route path="/llm-proxy" element={<LlmProxy />} />
              {/* Staff pages — role-gated by StaffLayout */}
              <Route element={<StaffLayout />}>
                <Route path="/staff/directory" element={<StaffDirectory />} />
              </Route>

              {/* Admin workflow pages — role-gated by AdminOnlyRoute.
                  Non-admin users at any of these paths are redirected to /account. */}
              <Route element={<AdminOnlyRoute />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/cohorts" element={<Cohorts />} />
                <Route path="/cohorts/:id" element={<CohortDetailPanel />} />
                <Route path="/groups" element={<Groups />} />
                <Route path="/groups/:id" element={<GroupDetailPanel />} />
                {/* /users redirects to the canonical /admin/users route (AdminUsersPanel) */}
                <Route path="/users" element={<Navigate to="/admin/users" replace />} />
                {/* Literal sub-paths come BEFORE /users/:id so they win
                   the match against the dynamic segment. */}
                <Route path="/users/students" element={<StudentAccountsPanel />} />
                <Route path="/users/llm-proxy" element={<LlmProxyUsersPanel />} />
                <Route path="/users/:id" element={<UserDetailPanel />} />
                <Route path="/sync" element={<SyncPanel />} />
                <Route path="/merge-queue" element={<MergeQueuePanel />} />
              </Route>

              {/* Admin ops pages — auth-gated by AdminLayout */}
              <Route element={<AdminLayout />}>
                <Route path="/admin/users" element={<AdminUsersPanel />} />
                <Route path="/admin/env" element={<EnvironmentInfo />} />
                <Route path="/admin/db" element={<DatabaseViewer />} />
                <Route path="/admin/config" element={<ConfigPanel />} />
                <Route path="/admin/logs" element={<LogViewer />} />
                <Route path="/admin/sessions" element={<SessionViewer />} />
                <Route path="/admin/scheduler" element={<ScheduledJobsPanel />} />
                <Route path="/admin/import-export" element={<ImportExport />} />
                <Route path="/admin/audit-log" element={<AuditLogPanel />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
          </OnboardingGate>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

export default App;
