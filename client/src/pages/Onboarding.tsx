/**
 * Onboarding — one-time setup shown immediately after a first-time OAuth
 * sign-in (before the user enters the main app). Collects the user's
 * display name. Defaults to whatever the OAuth provider reported, but the
 * student can overwrite it.
 *
 * Submitting the form hits POST /api/account/complete-onboarding, which
 * writes the display name and flips onboarding_completed=true on the User
 * row. The <OnboardingGate/> in App.tsx then unmounts this page and the
 * normal application renders.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Onboarding() {
  const { user, logout, refresh } = useAuth();
  const [name, setName] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the input with whatever name we already captured from Google/GitHub.
  useEffect(() => {
    if (user?.displayName) setName(user.displayName);
  }, [user?.displayName]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Please enter your full name.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/account/complete-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err: any) {
      setError(err.message ?? 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={shellStyle}>
      <form onSubmit={submit} style={cardStyle}>
        <h1 style={titleStyle}>Welcome to The League</h1>
        <p style={bodyStyle}>
          Before we finish setting up your account, please confirm your full
          name. This is what admins and staff will see.
        </p>
        <label style={labelStyle} htmlFor="displayName">
          Full name
        </label>
        <input
          id="displayName"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
          autoFocus
          style={inputStyle}
          disabled={submitting}
        />
        {error && (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        )}
        <div style={buttonRowStyle}>
          <button
            type="submit"
            disabled={submitting}
            style={primaryButtonStyle}
          >
            {submitting ? 'Saving…' : 'Continue'}
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={submitting}
            style={secondaryButtonStyle}
          >
            Sign out
          </button>
        </div>
      </form>
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
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 0.5rem',
  fontSize: '1.5rem',
  fontWeight: 700,
  color: '#1e293b',
};

const bodyStyle: React.CSSProperties = {
  margin: '0 0 1.25rem',
  fontSize: '0.9rem',
  color: '#475569',
  lineHeight: 1.5,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: '0.85rem',
  fontWeight: 500,
  color: '#475569',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: '0.95rem',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  boxSizing: 'border-box',
  marginBottom: '1rem',
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
  fontSize: '0.85rem',
  margin: '0 0 0.75rem',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'space-between',
  alignItems: 'center',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: '0.9rem',
  fontWeight: 600,
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: '0.9rem',
  fontWeight: 500,
  background: '#f1f5f9',
  color: '#1e293b',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  cursor: 'pointer',
};
