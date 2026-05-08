/**
 * AddCredentialsModal — first-time username/password setup modal.
 *
 * Shown from LoginsSection when the user has neither a username nor a
 * password (i.e. they have only OAuth logins). Collects username +
 * newPassword and calls PATCH /api/account/credentials with no
 * currentPassword (first-time-setup path added in Sprint 028 ticket 011).
 *
 * On success, calls onSuccess() so the parent can invalidate the
 * ['account'] query and the new passphrase Login row appears automatically.
 */

import { useState, useEffect, useRef, type FormEvent } from 'react';

interface AddCredentialsModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

async function patchCredentialsFirstTime(patch: {
  username: string;
  newPassword: string;
}): Promise<void> {
  const res = await fetch('/api/account/credentials', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(
      new Error((body as { error?: string }).error ?? `HTTP ${res.status}`),
      { status: res.status },
    );
  }
}

export default function AddCredentialsModal({
  open,
  onClose,
  onSuccess,
}: AddCredentialsModalProps) {
  const [username, setUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setUsername('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
      setSubmitting(false);
      // Focus the first field after render
      setTimeout(() => usernameRef.current?.focus(), 0);
    }
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError('Username is required.');
      return;
    }
    if (!newPassword) {
      setError('Password is required.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await patchCredentialsFirstTime({ username: trimmedUsername, newPassword });
      onSuccess();
      onClose();
    } catch (err: any) {
      const status: number = err.status ?? 0;
      if (status === 409) {
        setError('That username is already taken.');
      } else {
        setError(err.message ?? 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add username and password"
      style={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={styles.panel}>
        <h2 style={styles.title}>Add username &amp; password</h2>
        <p style={styles.description}>
          Set a username and password so you can sign in without a social provider.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} style={styles.form}>
          <div style={styles.fieldGroup}>
            <label htmlFor="acm-username" style={styles.label}>
              Username <span style={styles.required}>*</span>
            </label>
            <input
              id="acm-username"
              ref={usernameRef}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={submitting}
              style={styles.input}
              placeholder="choose a username"
            />
          </div>

          <div style={styles.fieldGroup}>
            <label htmlFor="acm-new-password" style={styles.label}>
              Password <span style={styles.required}>*</span>
            </label>
            <input
              id="acm-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              disabled={submitting}
              style={styles.input}
              placeholder="choose a password"
            />
          </div>

          <div style={styles.fieldGroup}>
            <label htmlFor="acm-confirm-password" style={styles.label}>
              Confirm password <span style={styles.required}>*</span>
            </label>
            <input
              id="acm-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              disabled={submitting}
              style={styles.input}
              placeholder="repeat password"
            />
          </div>

          {error && (
            <p role="alert" style={styles.inlineError}>
              {error}
            </p>
          )}

          <div style={styles.buttonRow}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={styles.cancelButton}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={styles.submitButton}
            >
              {submitting ? 'Saving…' : 'Set credentials'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  panel: {
    background: '#fff',
    borderRadius: 12,
    padding: '2rem',
    maxWidth: 440,
    width: '100%',
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  },
  title: {
    fontSize: '1.1rem',
    fontWeight: 700,
    color: '#1e293b',
    marginTop: 0,
    marginBottom: '0.5rem',
  },
  description: {
    fontSize: '0.9rem',
    color: '#64748b',
    marginBottom: '1.25rem',
    marginTop: 0,
    lineHeight: 1.5,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.75rem',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.25rem',
  },
  label: {
    fontSize: '0.85rem',
    fontWeight: 500,
    color: '#374151',
  },
  required: {
    color: '#dc2626',
    fontSize: '0.8rem',
  },
  input: {
    padding: '6px 10px',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    fontSize: '0.875rem',
    color: '#1e293b',
    background: '#fff',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  inlineError: {
    fontSize: '0.85rem',
    color: '#dc2626',
    margin: 0,
  },
  buttonRow: {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'flex-end',
    marginTop: '0.5rem',
  },
  cancelButton: {
    fontSize: '0.875rem',
    padding: '7px 18px',
    borderRadius: 6,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    color: '#374151',
    cursor: 'pointer',
    fontWeight: 500,
  },
  submitButton: {
    fontSize: '0.875rem',
    padding: '7px 18px',
    borderRadius: 6,
    border: 'none',
    background: '#4f46e5',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
  },
};
