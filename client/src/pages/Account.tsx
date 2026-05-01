/**
 * AccountPage — identity management page (Sprint 020).
 *
 * Renders for all authenticated roles: student, staff, and admin.
 * Student-only sections (Profile, Logins, UsernamePassword) are shown
 * only when role === 'student'.
 *
 * Sprint 020: ServicesSection, ClaudeCodeSection, and AccountLlmProxyCard
 * have been removed. Those UIs are moving to the Services page (ticket 005).
 * The tile launchpad (AppsZone) was removed in ticket 001.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useProviderStatus } from '../hooks/useProviderStatus';
import { useAccountEventStream } from '../hooks/useAccountEventStream';
import UsernamePasswordSection from './account/UsernamePasswordSection';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccountProfile {
  id: number;
  displayName: string | null;
  primaryEmail: string;
  cohort: { id: number; name: string } | null;
  role: string;
  approvalStatus?: 'approved' | 'pending';
  createdAt: string;
  /** Shared one-shot temp password for the League account (only set when
   *  the user has a live workspace ExternalAccount). */
  workspaceTempPassword?: string | null;
  /** True when the student has an active LLM proxy token. */
  llmProxyEnabled?: boolean;
  /** Username for passphrase / local login, or null if not set. */
  username?: string | null;
  /** True when a password_hash is stored for this account. */
  has_password?: boolean;
}

export interface AccountLogin {
  id: number;
  provider: string;
  providerEmail: string | null;
  providerUsername: string | null;
  createdAt: string;
}

export interface AccountExternalAccount {
  id: number;
  type: string;
  status: string;
  externalId: string | null;
  createdAt: string;
}

export interface AccountData {
  profile: AccountProfile;
  logins: AccountLogin[];
  externalAccounts: AccountExternalAccount[];
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchAccount(): Promise<AccountData> {
  const res = await fetch('/api/account');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Failed to load account (${res.status})`);
  }
  return res.json();
}

async function deleteLogin(id: number): Promise<void> {
  const res = await fetch(`/api/account/logins/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Failed to remove login (${res.status})`);
  }
}

async function patchDisplayName(displayName: string): Promise<void> {
  const res = await fetch('/api/account/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
  google: 'Google',
  pike13: 'Pike 13',
};

function providerLabel(p: string): string {
  return PROVIDER_LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

// ---------------------------------------------------------------------------
// ProfileSection
// ---------------------------------------------------------------------------

function ProfileSection({
  profile,
  onRename,
}: {
  profile: AccountProfile;
  onRename: (newName: string) => Promise<void>;
}) {
  const roleLabel =
    profile.role === 'admin' ? 'Admin' : profile.role === 'staff' ? 'Staff' : 'Student';
  const subtitle = profile.cohort
    ? `${roleLabel} · ${profile.cohort.name}`
    : roleLabel;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayed = profile.displayName ?? profile.primaryEmail;

  function startEdit() {
    setDraft(profile.displayName ?? '');
    setError(null);
    setEditing(true);
  }

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setError('Name cannot be empty.');
      return;
    }
    if (trimmed === profile.displayName) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRename(trimmed);
      setEditing(false);
    } catch (err: any) {
      setError(err.message ?? 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <header style={styles.profileHeader}>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          disabled={saving}
          style={styles.profileNameInput}
          aria-label="Edit display name"
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          style={styles.profileNameButton}
          title="Click to edit your name"
          aria-label={`Edit name (currently ${displayed})`}
        >
          {displayed}
        </button>
      )}
      {error && <div style={styles.profileNameError} role="alert">{error}</div>}
      <div style={styles.profileMeta}>{profile.primaryEmail}</div>
      <div style={styles.profileMeta}>{subtitle}</div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// LoginsSection
// ---------------------------------------------------------------------------

interface LoginsSectionProps {
  logins: AccountLogin[];
  onRemoveError: string | null;
  onRemove: (id: number) => void;
  removingId: number | null;
}

function LoginsSection({ logins, onRemoveError, onRemove, removingId }: LoginsSectionProps) {
  const providerStatus = useProviderStatus();

  const canRemove = logins.length > 1;

  return (
    <div style={styles.card}>
      <h2 style={styles.sectionTitle}>Sign-in Methods</h2>

      {logins.length === 0 ? (
        <p style={styles.emptyText}>No logins linked.</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Provider</th>
              <th style={styles.th}>Email / Username</th>
              <th style={styles.th}>Added</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {logins.map((login) => (
              <tr key={login.id} style={styles.tr}>
                <td style={styles.td}>{providerLabel(login.provider)}</td>
                <td style={styles.td}>
                  {login.providerEmail ?? login.providerUsername ?? '—'}
                </td>
                <td style={styles.td}>
                  {new Date(login.createdAt).toLocaleDateString()}
                </td>
                <td style={styles.td}>
                  <button
                    onClick={() => onRemove(login.id)}
                    disabled={!canRemove || removingId === login.id}
                    title={!canRemove ? 'At least one login must remain' : undefined}
                    aria-label={`Remove ${providerLabel(login.provider)} login`}
                    style={canRemove ? styles.removeButton : styles.removeButtonDisabled}
                  >
                    {removingId === login.id ? 'Removing…' : 'Remove'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {onRemoveError && (
        <p role="alert" style={styles.inlineError}>{onRemoveError}</p>
      )}

      {/* Add buttons — always visible regardless of which providers are linked.
          Google and GitHub are shown only when the provider is configured.
          Pike 13 is always shown (the link-mode flow landed in Sprint 015). */}
      {!providerStatus.loading && (
        <div style={styles.addRow}>
          {providerStatus.google && (
            <a
              href="/api/auth/google?link=1"
              style={styles.addButtonGoogle}
            >
              Add Google
            </a>
          )}
          {providerStatus.github && (
            <a
              href="/api/auth/github?link=1"
              style={styles.addButtonGitHub}
            >
              Add GitHub
            </a>
          )}
          <a
            href="/api/auth/pike13?link=1"
            style={styles.addButtonPike13}
          >
            Add Pike 13
          </a>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HelpSection
// ---------------------------------------------------------------------------

function HelpSection() {
  return (
    <div style={styles.card}>
      <h2 style={styles.sectionTitle}>Help &amp; Contact</h2>
      <p style={styles.helpText}>
        Need help with your account? Contact the League admin at{' '}
        <a href="mailto:admin@jointheleague.org" style={styles.helpLink}>
          admin@jointheleague.org
        </a>
        .
      </p>
      <p style={styles.helpText}>
        For provisioning issues or questions about your services, email the
        admin with your name and a description of the problem.
      </p>
    </div>
  );
}


// ---------------------------------------------------------------------------
// AccountPage — main component
// ---------------------------------------------------------------------------

export default function Account() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const role = user?.role?.toLowerCase();
  const isStudent = role === 'student';

  // Open SSE connection to receive real-time account updates from the server.
  useAccountEventStream();

  // All hooks must be called unconditionally before any early return.
  // The student-only /api/account endpoint is guarded so non-students don't
  // get a 403 noise in the console.
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<AccountData>({
    queryKey: ['account'],
    queryFn: fetchAccount,
    // Only fetch student account data for students.
    enabled: isStudent,
    // While the account is pending, poll so the banner clears as soon as an
    // admin approves the account. After approval, rely on normal refetching.
    refetchInterval: (query) =>
      query.state.data?.profile.approvalStatus === 'pending' ? 5000 : false,
  });

  const removeLoginMutation = useMutation({
    mutationFn: deleteLogin,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['account'] });
    },
  });

  // Show loading skeleton only for students (waiting on /api/account).
  if (isStudent && isLoading) {
    return (
      <div style={styles.container}>
        <h1 style={styles.pageTitle}>My Account</h1>
        <div style={styles.loadingCard} aria-busy="true" aria-label="Loading account data">
          <div style={styles.skeletonLine} />
          <div style={{ ...styles.skeletonLine, width: '60%' }} />
          <div style={{ ...styles.skeletonLine, width: '80%' }} />
        </div>
      </div>
    );
  }

  if (isStudent && (isError || !data)) {
    return (
      <div style={styles.container}>
        <h1 style={styles.pageTitle}>My Account</h1>
        <div style={styles.errorCard}>
          <p role="alert" style={styles.errorText}>
            {error instanceof Error ? error.message : 'Failed to load account data.'}
          </p>
          <button
            onClick={() => void refetch()}
            style={styles.retryButton}
            aria-label="Retry loading account"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const hasCredentials =
    isStudent &&
    data != null &&
    ((data.profile.username ?? null) !== null || data.profile.has_password === true);

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>My Account</h1>

      {/* Student-only sections: Profile, Logins, UsernamePassword */}
      {isStudent && data && (
        <>
          <ProfileSection
            profile={data.profile}
            onRename={async (newName) => {
              await patchDisplayName(newName);
              await queryClient.invalidateQueries({ queryKey: ['account'] });
            }}
          />

          <div style={styles.spacer} />

          <LoginsSection
            logins={data.logins}
            onRemoveError={
              removeLoginMutation.isError
                ? removeLoginMutation.error instanceof Error
                  ? removeLoginMutation.error.message
                  : 'Failed to remove login'
                : null
            }
            onRemove={(id) => removeLoginMutation.mutate(id)}
            removingId={removeLoginMutation.isPending ? (removeLoginMutation.variables ?? null) : null}
          />

          {hasCredentials && (
            <>
              <div style={styles.spacer} />
              <UsernamePasswordSection
                username={data.profile.username ?? null}
                onSuccess={() => {
                  void queryClient.invalidateQueries({ queryKey: ['account'] });
                }}
              />
            </>
          )}

          <div style={styles.spacer} />
        </>
      )}

      <HelpSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 720,
    margin: '40px auto',
    padding: '0 1rem',
  },
  pageTitle: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#1e293b',
    marginBottom: '1.5rem',
  },
  spacer: {
    height: '1rem',
  },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '1.5rem',
    background: '#fff',
  },
  loadingCard: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '2rem',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  skeletonLine: {
    height: 16,
    background: '#e2e8f0',
    borderRadius: 4,
    width: '100%',
    animation: 'pulse 1.5s ease-in-out infinite',
  },
  errorCard: {
    border: '1px solid #fca5a5',
    borderRadius: 12,
    padding: '1.5rem',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    alignItems: 'flex-start',
  },
  errorText: {
    color: '#dc2626',
    fontSize: '0.9rem',
    margin: 0,
  },
  retryButton: {
    fontSize: '0.85rem',
    padding: '6px 16px',
    borderRadius: 6,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    color: '#1e293b',
    cursor: 'pointer',
    fontWeight: 500,
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: '1rem',
    marginTop: 0,
  },
  profileHeader: {
    marginBottom: '1.5rem',
  },
  profileNameButton: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: 4,
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    textAlign: 'left',
    font: 'inherit',
  },
  profileNameInput: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: 4,
    padding: '2px 6px',
    border: '1px solid #cbd5e1',
    borderRadius: 4,
    background: '#fff',
    width: '100%',
    maxWidth: 420,
    boxSizing: 'border-box',
  },
  profileNameError: {
    color: '#dc2626',
    fontSize: '0.8rem',
    marginBottom: 4,
  },
  profileMeta: {
    fontSize: '0.9rem',
    color: '#64748b',
    lineHeight: 1.5,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '0.875rem',
  },
  th: {
    textAlign: 'left' as const,
    padding: '6px 8px',
    color: '#64748b',
    fontWeight: 500,
    borderBottom: '1px solid #e2e8f0',
  },
  tr: {
    borderBottom: '1px solid #f1f5f9',
  },
  td: {
    padding: '8px 8px',
    color: '#1e293b',
    verticalAlign: 'middle' as const,
  },
  removeButton: {
    fontSize: '0.8rem',
    padding: '3px 10px',
    borderRadius: 5,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    color: '#64748b',
    cursor: 'pointer',
  },
  removeButtonDisabled: {
    fontSize: '0.8rem',
    padding: '3px 10px',
    borderRadius: 5,
    border: '1px solid #e2e8f0',
    background: '#f1f5f9',
    color: '#cbd5e1',
    cursor: 'not-allowed',
    opacity: 0.6,
  },
  addRow: {
    display: 'flex',
    gap: '0.5rem',
    marginTop: '1rem',
    flexWrap: 'wrap' as const,
  },
  addButtonGoogle: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 14px',
    borderRadius: 8,
    fontSize: '0.85rem',
    fontWeight: 600,
    textDecoration: 'none',
    cursor: 'pointer',
    background: '#fff',
    color: '#374151',
    border: '1px solid #d1d5db',
  },
  addButtonGitHub: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 14px',
    borderRadius: 8,
    fontSize: '0.85rem',
    fontWeight: 600,
    textDecoration: 'none',
    cursor: 'pointer',
    background: '#24292e',
    color: '#fff',
    border: 'none',
  },
  addButtonPike13: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 14px',
    borderRadius: 8,
    fontSize: '0.85rem',
    fontWeight: 600,
    textDecoration: 'none',
    cursor: 'pointer',
    background: '#0ea5e9',
    color: '#fff',
    border: 'none',
  },
  inlineError: {
    fontSize: '0.85rem',
    color: '#dc2626',
    marginTop: '0.75rem',
    marginBottom: 0,
  },
  emptyText: {
    fontSize: '0.85rem',
    color: '#64748b',
  },
  helpText: {
    fontSize: '0.9rem',
    color: '#374151',
    marginBottom: '0.5rem',
    lineHeight: 1.6,
  },
  helpLink: {
    color: '#4f46e5',
  },
};
