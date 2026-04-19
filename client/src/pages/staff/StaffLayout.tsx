import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * StaffLayout — role guard for staff routes.
 *
 * Allows access when role === 'staff' or role === 'admin' (for admin test
 * access). Redirects authenticated non-staff users to /account, and
 * unauthenticated users to /login.
 *
 * Relies on AppLayout (parent route) to handle the loading state and initial
 * auth check, so we only need to inspect the resolved user here.
 */
export default function StaffLayout() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'staff' && user.role !== 'admin') {
    return <Navigate to="/account" replace />;
  }

  return <Outlet />;
}
