/**
 * AccountPage — student self-service account management.
 *
 * Fetches data from GET /api/account (aggregate endpoint) and renders four
 * sections: Profile, Logins, Services, and Help.
 *
 * Staff and admin users are redirected to /staff immediately without fetching.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useProviderStatus } from '../hooks/useProviderStatus';
import { useAccountEventStream } from '../hooks/useAccountEventStream';
import AccountLlmProxyCard from './account/AccountLlmProxyCard';

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
};

function providerLabel(p: string): string {
  return PROVIDER_LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

/** League emails are @jointheleague.org or any subdomain (e.g. students). */
function isLeagueEmail(email: string): boolean {
  return /@([a-z0-9-]+\.)?jointheleague\.org$/i.test(email);
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

  const linkedProviderNames = new Set(logins.map((l) => l.provider));

  // Only show "Add" links for providers that are: configured AND not yet linked.
  // We only support google and github Add links (not pike13).
  const addableProviders = (['google', 'github'] as const).filter(
    (p) => providerStatus[p] && !linkedProviderNames.has(p),
  );

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

      {!providerStatus.loading && addableProviders.length > 0 && (
        <div style={styles.addRow}>
          {addableProviders.map((provider) => (
            <a
              key={provider}
              href={`/api/auth/${provider}?link=1`}
              style={provider === 'github' ? styles.addButtonGitHub : styles.addButtonGoogle}
            >
              Add {providerLabel(provider)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ServicesSection — read-only status of the account's services. Requests
// are no longer student-initiated; admins grant workspace, Claude, and
// LLM proxy directly from the admin UI.
// ---------------------------------------------------------------------------

function ServicesSection({ data }: { data: AccountData }) {
  if (data.profile.approvalStatus === 'pending') {
    return (
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Services</h2>
        <div style={styles.pendingBanner} role="status">
          <strong>Your account is pending approval.</strong>
          <span>
            {' '}An admin will review your sign-in shortly. Once approved, any
            services they grant you will show up here.
          </span>
        </div>
      </div>
    );
  }

  const workspaceAccount = data.externalAccounts.find((a) => a.type === 'workspace');
  const claudeAccount = data.externalAccounts.find((a) => a.type === 'claude');
  const pike13Account = data.externalAccounts.find((a) => a.type === 'pike13');

  const leagueEmailDisplay: string | null =
    workspaceAccount?.externalId ??
    (isLeagueEmail(data.profile.primaryEmail) ? data.profile.primaryEmail : null);

  return (
    <div style={styles.card}>
      <h2 style={styles.sectionTitle}>Services</h2>
      <p style={styles.helpText}>
        Accounts are granted by an admin. If something you expect is
        missing, reach out to your instructor.
      </p>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Service</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr style={styles.tr}>
            <td style={styles.td}>League Email</td>
            <td style={styles.td}>{workspaceAccount?.status ?? 'None'}</td>
            <td style={styles.td}>
              {workspaceAccount && leagueEmailDisplay ? (
                <div style={styles.emailColumn}>
                  <span style={styles.emailValue}>{leagueEmailDisplay}</span>
                  {data.profile.workspaceTempPassword && (
                    <span
                      style={styles.tempPasswordHint}
                      title="Shared temp password — you'll be asked to change it on first sign-in"
                    >
                      password: <code style={styles.emailValue}>{data.profile.workspaceTempPassword}</code>
                    </span>
                  )}
                </div>
              ) : null}
            </td>
          </tr>

          <tr style={styles.tr}>
            <td style={styles.td}>Claude Seat</td>
            <td style={styles.td}>{claudeAccount?.status ?? 'None'}</td>
            <td style={styles.td}></td>
          </tr>

          <tr style={styles.tr}>
            <td style={styles.td}>LLM Proxy</td>
            <td style={styles.td}>
              {data.profile.llmProxyEnabled ? 'active' : 'None'}
            </td>
            <td style={styles.td}></td>
          </tr>

          <tr style={styles.tr}>
            <td style={styles.td}>Pike13</td>
            <td style={styles.td}>{pike13Account?.status ?? 'None'}</td>
            <td style={styles.td}>
              <span style={styles.readOnlyHint}>Managed by staff</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ClaudeCodeSection — onboarding instructions once the student's Claude
// invite is active. Anthropic's Admin API doesn't let us mint API keys on
// another member's behalf, so instead we point the student at Claude Code's
// built-in OAuth flow — `claude auth login` — which authenticates against
// their org membership without any key handling.
// ---------------------------------------------------------------------------

function ClaudeCodeSection({ data }: { data: AccountData }) {
  const claudeAccount = data.externalAccounts.find((a) => a.type === 'claude');
  if (!claudeAccount) return null;

  const active = claudeAccount.status === 'active';
  const pending = claudeAccount.status === 'pending';

  return (
    <div style={styles.card}>
      <h2 style={styles.sectionTitle}>Claude Code</h2>
      {pending && (
        <p style={styles.helpText}>
          Your Claude invite is pending. Check your inbox for an email from
          Anthropic and accept the invitation before continuing.
        </p>
      )}
      {active && (
        <>
          <p style={styles.helpText}>
            You can use <strong>Claude Code</strong> (the CLI) directly against
            The League's Anthropic org — no API key needed. Usage is billed to
            the school, not to you.
          </p>
          <ol style={styles.claudeSteps}>
            <li>
              <strong>Install Claude Code:</strong>{' '}
              <code style={styles.code}>curl -fsSL https://claude.ai/install.sh | bash</code>{' '}
              (or see{' '}
              <a
                href="https://docs.claude.com/claude-code"
                target="_blank"
                rel="noreferrer"
                style={styles.helpLink}
              >
                the install guide
              </a>
              ).
            </li>
            <li>
              <strong>Sign in:</strong>{' '}
              <code style={styles.code}>claude auth login</code>
              <div style={styles.claudeHint}>
                A browser window opens. Sign in with your{' '}
                <strong>{data.profile.primaryEmail}</strong> account — the one
                invited into the League Anthropic org.
              </div>
            </li>
            <li>
              <strong>Verify:</strong>{' '}
              <code style={styles.code}>claude "hello"</code>
              <div style={styles.claudeHint}>
                You should get a reply. If Claude Code asks for an API key,
                you're signed into the wrong account — run{' '}
                <code style={styles.codeInline}>claude auth logout</code> and
                start over.
              </div>
            </li>
          </ol>
          <p style={styles.claudeFooter}>
            Your tokens refresh automatically — you won't need to log in again
            unless you switch machines.
          </p>
        </>
      )}
      {!active && !pending && (
        <p style={styles.helpText}>
          Claude access is not currently available on your account
          ({claudeAccount.status}). Contact the League admin if this looks
          wrong.
        </p>
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
  const isNonStudent = role === 'staff' || role === 'admin';

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
    // Skip fetching if the user is not a student — they will be redirected.
    enabled: !isNonStudent,
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

  // Admin redirect — to the admin dashboard (has actual admin UI).
  // Staff falls through and renders the account page (empty but won't 404).
  if (role === 'admin') {
    return <Navigate to="/" replace />;
  }

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

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>My Account</h1>

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

      <div style={styles.spacer} />

      <ServicesSection data={data} />

      <div style={styles.spacer} />

      <ClaudeCodeSection data={data} />

      <div style={styles.spacer} />

      <AccountLlmProxyCard />

      <div style={styles.spacer} />

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
  profileName: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: 4,
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
  pendingBanner: {
    padding: '14px 16px',
    borderRadius: 8,
    border: '1px solid #fcd34d',
    background: '#fef3c7',
    color: '#78350f',
    fontSize: '0.9rem',
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
  requestButton: {
    fontSize: '0.82rem',
    padding: '4px 12px',
    borderRadius: 6,
    border: '1px solid #4f46e5',
    background: '#4f46e5',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 500,
  },
  disabledHint: {
    fontSize: '0.82rem',
    color: '#94a3b8',
    fontStyle: 'italic' as const,
  },
  emailValue: {
    fontSize: '0.85rem',
    color: '#1e293b',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  emailColumn: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  tempPasswordHint: {
    fontSize: '0.78rem',
    color: '#64748b',
  },
  readOnlyHint: {
    fontSize: '0.82rem',
    color: '#94a3b8',
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
  claudeSteps: {
    fontSize: '0.9rem',
    color: '#374151',
    lineHeight: 1.8,
    paddingLeft: '1.25rem',
  } as const,
  code: {
    display: 'inline-block',
    background: '#0f172a',
    color: '#e2e8f0',
    padding: '3px 8px',
    borderRadius: 4,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.82rem',
    userSelect: 'all' as const,
  },
  codeInline: {
    background: '#f1f5f9',
    color: '#0f172a',
    padding: '1px 5px',
    borderRadius: 3,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.82rem',
  },
  claudeHint: {
    fontSize: '0.8rem',
    color: '#64748b',
    marginTop: 4,
    marginLeft: 2,
  },
  claudeFooter: {
    fontSize: '0.82rem',
    color: '#64748b',
    marginTop: 12,
    fontStyle: 'italic',
  },
};
