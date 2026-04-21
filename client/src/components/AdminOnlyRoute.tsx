import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Route guard that renders <Outlet /> only for users with role === 'admin'
 * (case-insensitive). All other authenticated users and unauthenticated
 * visitors are redirected to /account.
 */
export default function AdminOnlyRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (user?.role?.toLowerCase() !== 'admin') {
    return <Navigate to="/account" replace />;
  }

  return <Outlet />;
}
