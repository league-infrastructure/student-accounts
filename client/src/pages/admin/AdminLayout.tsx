import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

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

  return <Outlet />;
}
