import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { hasAdminAccess } from '../../lib/roles';

export default function AdminLogin() {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // ADMIN-role users bypass the password form entirely
  useEffect(() => {
    if (user && hasAdminAccess(user.role)) {
      navigate('/admin/users', { replace: true });
    }
  }, [user, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        navigate('/admin/users');
      } else {
        const data = await res.json();
        setError(data.error || 'Invalid password');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '100px auto', padding: 24 }}>
      <h1>Admin Login</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="password" style={{ display: 'block', marginBottom: 4 }}>
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            style={{ width: '100%', padding: 8, fontSize: 16 }}
          />
        </div>
        {error && (
          <div style={{ color: 'red', marginBottom: 12 }}>{error}</div>
        )}
        <button
          type="submit"
          disabled={loading || !password}
          style={{ padding: '8px 24px', fontSize: 16 }}
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}
