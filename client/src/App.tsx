import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';

import About from './pages/About';
import McpSetup from './pages/McpSetup';
import NotFound from './pages/NotFound';
import Account from './pages/Account';

import AdminLogin from './pages/admin/AdminLogin';
import AdminLayout from './pages/admin/AdminLayout';
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
              <Route path="/" element={<Navigate to="/account" replace />} />

              <Route path="/about" element={<About />} />
              <Route path="/account" element={<Account />} />
              <Route path="/mcp-setup" element={<McpSetup />} />

              {/* Admin pages — auth-gated by AdminLayout */}
              <Route element={<AdminLayout />}>
                <Route path="/admin/users" element={<UsersPanel />} />
                <Route path="/admin/users/:id" element={<UserDetailPanel />} />
                <Route path="/admin/env" element={<EnvironmentInfo />} />
                <Route path="/admin/db" element={<DatabaseViewer />} />
                <Route path="/admin/config" element={<ConfigPanel />} />
                <Route path="/admin/logs" element={<LogViewer />} />
                <Route path="/admin/sessions" element={<SessionViewer />} />
                <Route path="/admin/scheduler" element={<ScheduledJobsPanel />} />
                <Route path="/admin/import-export" element={<ImportExport />} />
                <Route path="/admin/provisioning-requests" element={<ProvisioningRequests />} />
                <Route path="/admin/cohorts" element={<Cohorts />} />
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
