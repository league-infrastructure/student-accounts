/**
 * PendingApproval — the only page a pending-approval user sees. No sidebar,
 * no account section, no navigation. Just a message and a logout button.
 *
 * Polls /api/auth/me every 5s so the page progresses to the normal app
 * automatically as soon as an admin approves the account.
 */

import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const POLL_INTERVAL_MS = 5000;

export default function PendingApproval() {
  const { user, logout, refresh } = useAuth();

  useEffect(() => {
    const id = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div style={shellStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>Your account is pending</h1>
        <p style={bodyStyle}>
          Your sign-in has been received. A League admin will review your
          account shortly — check back later.
        </p>
        {user?.email && (
          <p style={emailStyle}>
            Signed in as <strong>{user.email}</strong>
          </p>
        )}
        <button
          type="button"
          onClick={() => void logout()}
          style={buttonStyle}
          aria-label="Sign out"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f8fafc',
  padding: '2rem',
};

const cardStyle: React.CSSProperties = {
  maxWidth: 480,
  width: '100%',
  padding: '2.5rem',
  background: '#fff',
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.05)',
  textAlign: 'center',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 1rem',
  fontSize: '1.5rem',
  fontWeight: 700,
  color: '#1e293b',
};

const bodyStyle: React.CSSProperties = {
  margin: '0 0 1rem',
  fontSize: '0.95rem',
  color: '#475569',
  lineHeight: 1.5,
};

const emailStyle: React.CSSProperties = {
  margin: '0 0 1.5rem',
  fontSize: '0.85rem',
  color: '#64748b',
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: '0.9rem',
  fontWeight: 500,
  background: '#f1f5f9',
  color: '#1e293b',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  cursor: 'pointer',
};
