/**
 * AccountPage — identity management page (Sprint 020, widened Sprint 022).
 *
 * Renders for all authenticated roles: student, staff, and admin.
 * Profile, Logins (with all three Add-Login buttons), and
 * UsernamePasswordSection are shown for every authenticated user.
 * WorkspaceSection hides itself when the user has no workspace
 * ExternalAccount and no League-format primary email.
 *
 * Sprint 020: ServicesSection, ClaudeCodeSection, and AccountLlmProxyCard
 * have been removed. Those UIs are moving to the Services page (ticket 005).
 * The tile launchpad (AppsZone) was removed in ticket 001.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
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

/** League emails are @jointheleague.org or any subdomain. */
function isLeagueEmail(email: string): boolean {
  return /@([a-z0-9-]+\.)?jointheleague\.org$/i.test(email);
}

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

/* ---- Provider icons (inline SVG, brand-recognizable) ---- */

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 8 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.3 19 12 24 12c3 0 5.8 1.1 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41.9 35.6 44 30.2 44 24c0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18.91-.25 1.89-.38 2.86-.38.97 0 1.95.13 2.86.38 2.19-1.49 3.15-1.18 3.15-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.41-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
    </svg>
  );
}

function Pike13Icon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#0ea5e9"/>
      <text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">P13</text>
    </svg>
  );
}

interface LoginsSectionProps {
  logins: AccountLogin[];
  onRemoveError: string | null;
  onRemove: (id: number) => void;
  removingId: number | null;
}

function LoginsSection({ logins, onRemoveError, onRemove, removingId }: LoginsSectionProps) {
  const canRemove = logins.length > 1;
  const hasPike13 = logins.some((l) => l.provider === 'pike13');

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

      {/* Add buttons. Google and GitHub are always shown — multiple logins
          per provider are allowed. Pike 13 is one-per-account and hidden
          once linked. If a provider's OAuth env isn't configured, the
          server returns 501 with setup instructions when the user clicks. */}
      <div style={styles.addRow}>
        <a href="/api/auth/google?link=1" style={styles.addButton}>
          <GoogleIcon /> Add Google
        </a>
        <a href="/api/auth/github?link=1" style={styles.addButton}>
          <GitHubIcon /> Add GitHub
        </a>
        {!hasPike13 && (
          <a href="/api/auth/pike13?link=1" style={styles.addButton}>
            <Pike13Icon /> Add Pike 13
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceSection — League Email + temp-password display (students only)
// ---------------------------------------------------------------------------

/**
 * Shows the student's League Workspace email address and, when set, the
 * shared temp password they need to use on first sign-in.
 *
 * Returns null when:
 *  - The student has no workspace ExternalAccount AND no League-format email.
 *  (The pending-banner variant is handled first and always renders for pending
 *   accounts regardless of workspace status.)
 */
function WorkspaceSection({ data }: { data: AccountData }) {
  if (data.profile.approvalStatus === 'pending') {
    return (
      <div style={styles.card} data-testid="workspace-section">
        <h2 style={styles.sectionTitle}>League Email</h2>
        <div style={styles.pendingBanner} role="status">
          <strong>Your account is pending approval.</strong>
          <span>
            {' '}An admin will review your sign-in shortly. Once approved, your
            League email and any other services will appear here.
          </span>
        </div>
      </div>
    );
  }

  const workspaceAccount = data.externalAccounts.find((a) => a.type === 'workspace');
  const leagueEmailDisplay: string | null =
    workspaceAccount?.externalId ??
    (isLeagueEmail(data.profile.primaryEmail) ? data.profile.primaryEmail : null);

  // Nothing to show — hide entirely.
  if (!workspaceAccount && !leagueEmailDisplay) return null;

  return (
    <div style={styles.card} data-testid="workspace-section">
      <h2 style={styles.sectionTitle}>League Email</h2>
      {leagueEmailDisplay && (
        <div style={styles.workspaceEmailRow}>
          <span style={styles.workspaceEmailValue}>{leagueEmailDisplay}</span>
          {data.profile.workspaceTempPassword && (
            <span
              style={styles.tempPasswordHint}
              title="Shared temp password — you'll be asked to change it on first sign-in"
            >
              password:{' '}
              <code style={styles.workspaceEmailValue}>
                {data.profile.workspaceTempPassword}
              </code>
            </span>
          )}
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
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();

  // Open SSE connection to receive real-time account updates from the server.
  useAccountEventStream();

  // All hooks must be called unconditionally before any early return.
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<AccountData>({
    queryKey: ['account'],
    queryFn: fetchAccount,
    // Fetch for any authenticated user once auth has resolved.
    enabled: !loading && !!user,
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

  // Show loading skeleton while waiting on /api/account.
  if (isLoading) {
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

  if (isError || !data) {
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
    data != null &&
    ((data.profile.username ?? null) !== null || data.profile.has_password === true);

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>My Account</h1>

      {/* Identity sections: Profile, Logins, UsernamePassword — all roles */}
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
        <WorkspaceSection data={data} />
        <div style={styles.spacer} />
      </>

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
  addButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
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
  pendingBanner: {
    padding: '14px 16px',
    borderRadius: 8,
    border: '1px solid #fcd34d',
    background: '#fef3c7',
    color: '#78350f',
    fontSize: '0.9rem',
    lineHeight: 1.5,
  },
  workspaceEmailRow: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  workspaceEmailValue: {
    fontSize: '0.85rem',
    color: '#1e293b',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  tempPasswordHint: {
    fontSize: '0.78rem',
    color: '#64748b',
  },
};
