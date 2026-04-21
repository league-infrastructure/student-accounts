import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import AppLayout from './components/AppLayout';
import AdminOnlyRoute from './components/AdminOnlyRoute';
import Login from './pages/Login';

import About from './pages/About';
import McpSetup from './pages/McpSetup';
import NotFound from './pages/NotFound';
import Account from './pages/Account';

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
import UsersPanel from './pages/admin/UsersPanel';
import UserDetailPanel from './pages/admin/UserDetailPanel';
import ProvisioningRequests from './pages/admin/ProvisioningRequests';
import Cohorts from './pages/admin/Cohorts';
import CohortDetailPanel from './pages/admin/CohortDetailPanel';
import SyncPanel from './pages/admin/SyncPanel';
import MergeQueuePanel from './pages/admin/MergeQueuePanel';
import Dashboard from './pages/admin/Dashboard';

import StaffLayout from './pages/staff/StaffLayout';
import StaffDirectory from './pages/staff/StaffDirectory';

const queryClient = new QueryClient();

function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Routes>
            {/* Standalone pages (no AppLayout) */}
            <Route path="/login" element={<Login />} />

            {/* Admin login (standalone, no layout) */}
            <Route path="/admin" element={<AdminLogin />} />

            {/* All authenticated routes share AppLayout (sidebar + topbar) */}
            <Route element={<AppLayout />}>
              <Route path="/about" element={<About />} />
              <Route path="/account" element={<Account />} />
              <Route path="/mcp-setup" element={<McpSetup />} />

              {/* Staff pages — role-gated by StaffLayout */}
              <Route element={<StaffLayout />}>
                <Route path="/staff/directory" element={<StaffDirectory />} />
              </Route>

              {/* Admin workflow pages — role-gated by AdminOnlyRoute.
                  Non-admin users at any of these paths are redirected to /account. */}
              <Route element={<AdminOnlyRoute />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/requests" element={<ProvisioningRequests />} />
                <Route path="/cohorts" element={<Cohorts />} />
                <Route path="/cohorts/:id" element={<CohortDetailPanel />} />
                <Route path="/users" element={<UsersPanel />} />
                <Route path="/users/:id" element={<UserDetailPanel />} />
                <Route path="/sync" element={<SyncPanel />} />
                <Route path="/merge-queue" element={<MergeQueuePanel />} />
              </Route>

              {/* Admin ops pages — auth-gated by AdminLayout */}
              <Route element={<AdminLayout />}>
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
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

export default App;
