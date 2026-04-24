import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAdminEventStream } from '../../hooks/useAdminEventStream';

/**
 * Admin auth gate — checks /api/admin/check and redirects to admin login
 * if not authenticated. Layout is handled by AppLayout.
 */
export default function AdminLayout() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/admin/check')
      .then((res) => res.json())
      .then((data) => {
        if (!data.authenticated) navigate('/admin', { replace: true });
      })
      .catch(() => navigate('/admin', { replace: true }))
      .finally(() => setChecking(false));
  }, [navigate]);

  if (checking) return null;

  return (
    <>
      <AdminEventStreamMount />
      <Outlet />
    </>
  );
}

/**
 * Mount the admin SSE listener exactly once for the lifetime of the admin
 * session. Rendered inside AdminLayout only after the auth check passes,
 * so the EventSource never opens against an unauthenticated session.
 */
function AdminEventStreamMount() {
  useAdminEventStream();
  return null;
}
