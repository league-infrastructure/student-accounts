/**
 * UsernamePasswordSection — self-service username / password management.
 *
 * Rendered only when the account already has a username OR a password
 * (`profile.username != null || profile.has_password === true`).
 * Users who signed up exclusively via OAuth will never see this section.
 *
 * Calls PATCH /api/account/credentials on submit:
 *   body: { username?, currentPassword, newPassword? }
 *
 * Error mapping:
 *   400 — generic validation error from the server
 *   401 — "Current password is incorrect"
 *   409 — "Username already taken"
 */

import { useState, FormEvent } from 'react';

interface UsernamePasswordSectionProps {
  username: string | null;
  onSuccess: () => void;
}

async function patchCredentials(patch: {
  username?: string;
  currentPassword: string;
  newPassword?: string;
}): Promise<{ id: number; username: string | null }> {
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
  return body as { id: number; username: string | null };
}

export default function UsernamePasswordSection({
  username,
  onSuccess,
}: UsernamePasswordSectionProps) {
  const [draftUsername, setDraftUsername] = useState(username ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    // Client-side: confirm passwords match before hitting the API.
    if (newPassword && newPassword !== confirmNewPassword) {
      setError('New passwords do not match.');
      return;
    }

    const patch: { username?: string; currentPassword: string; newPassword?: string } = {
      currentPassword,
    };

    const trimmedUsername = draftUsername.trim();
    if (trimmedUsername !== (username ?? '')) {
      patch.username = trimmedUsername;
    }
    if (newPassword) {
      patch.newPassword = newPassword;
    }

    if (patch.username === undefined && patch.newPassword === undefined) {
      setError('Nothing to update — change at least one field.');
      return;
    }

    setSubmitting(true);
    try {
      await patchCredentials(patch);
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      onSuccess();
    } catch (err: any) {
      const status: number = err.status ?? 0;
      if (status === 401) {
        setError('Current password is incorrect.');
      } else if (status === 409) {
        setError('Username already taken.');
      } else {
        setError(err.message ?? 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.sectionTitle}>Username &amp; Password</h2>
      <form onSubmit={(e) => void handleSubmit(e)} style={styles.form}>
        <div style={styles.fieldGroup}>
          <label htmlFor="ups-username" style={styles.label}>
            Username
          </label>
          <input
            id="ups-username"
            type="text"
            value={draftUsername}
            onChange={(e) => setDraftUsername(e.target.value)}
            autoComplete="username"
            disabled={submitting}
            style={styles.input}
            placeholder="username"
          />
        </div>

        <div style={styles.fieldGroup}>
          <label htmlFor="ups-current-password" style={styles.label}>
            Current password <span style={styles.required}>*</span>
          </label>
          <input
            id="ups-current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={submitting}
            style={styles.input}
            placeholder="required to save changes"
          />
        </div>

        <div style={styles.fieldGroup}>
          <label htmlFor="ups-new-password" style={styles.label}>
            New password
          </label>
          <input
            id="ups-new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            disabled={submitting}
            style={styles.input}
            placeholder="leave blank to keep current"
          />
        </div>

        <div style={styles.fieldGroup}>
          <label htmlFor="ups-confirm-password" style={styles.label}>
            Confirm new password
          </label>
          <input
            id="ups-confirm-password"
            type="password"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            autoComplete="new-password"
            disabled={submitting}
            style={styles.input}
            placeholder="repeat new password"
          />
        </div>

        {error && (
          <p role="alert" style={styles.inlineError}>
            {error}
          </p>
        )}
        {success && (
          <p role="status" style={styles.successMsg}>
            Saved.
          </p>
        )}

        <button type="submit" disabled={submitting} style={styles.submitButton}>
          {submitting ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '1.5rem',
    background: '#fff',
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: '1rem',
    marginTop: 0,
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
    maxWidth: 380,
    boxSizing: 'border-box' as const,
  },
  inlineError: {
    fontSize: '0.85rem',
    color: '#dc2626',
    margin: 0,
  },
  successMsg: {
    fontSize: '0.85rem',
    color: '#16a34a',
    margin: 0,
  },
  submitButton: {
    alignSelf: 'flex-start',
    fontSize: '0.85rem',
    padding: '7px 18px',
    borderRadius: 6,
    border: 'none',
    background: '#4f46e5',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
  },
};
