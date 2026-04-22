/**
 * AccountPage — student self-service account management.
 *
 * Fetches data from GET /api/account (aggregate endpoint) and renders four
 * sections: Profile, Logins, Services, and Help.
 *
 * Staff and admin users are redirected to /staff immediately without fetching.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useProviderStatus } from '../hooks/useProviderStatus';

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

export interface AccountProvisioningRequest {
  id: number;
  requestedType: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
}

export interface AccountData {
  profile: AccountProfile;
  logins: AccountLogin[];
  externalAccounts: AccountExternalAccount[];
  provisioningRequests: AccountProvisioningRequest[];
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

async function postProvisioningRequest(requestType: string): Promise<AccountProvisioningRequest[]> {
  const res = await fetch('/api/account/provisioning-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return res.json();
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

/** Returns true when the student has a pending or active workspace account or request. */
function hasWorkspaceBaseline(data: AccountData): boolean {
  const activeWorkspace = data.externalAccounts.some(
    (a) => a.type === 'workspace' && (a.status === 'active'),
  );
  if (activeWorkspace) return true;
  const pendingWorkspaceRequest = data.provisioningRequests.some(
    (r) =>
      (r.requestedType === 'workspace' || r.requestedType === 'workspace_and_claude') &&
      (r.status === 'pending' || r.status === 'approved'),
  );
  return pendingWorkspaceRequest;
}

/** League emails are @jointheleague.org or any subdomain (e.g. students). */
function isLeagueEmail(email: string): boolean {
  return /@([a-z0-9-]+\.)?jointheleague\.org$/i.test(email);
}

// ---------------------------------------------------------------------------
// ProfileSection
// ---------------------------------------------------------------------------

function ProfileSection({ profile }: { profile: AccountProfile }) {
  const roleLabel =
    profile.role === 'admin' ? 'Admin' : profile.role === 'staff' ? 'Staff' : 'Student';
  const subtitle = profile.cohort
    ? `${roleLabel} · ${profile.cohort.name}`
    : roleLabel;
  return (
    <header style={styles.profileHeader}>
      <div style={styles.profileName}>{profile.displayName ?? profile.primaryEmail}</div>
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
// ServicesSection
// ---------------------------------------------------------------------------

interface ServicesSectionProps {
  data: AccountData;
  onRequest: (requestType: string) => void;
  requesting: boolean;
  requestError: string | null;
}

function ServicesSection({ data, onRequest, requesting, requestError }: ServicesSectionProps) {
  // Pending users see a banner instead of the services table — no services
  // can be requested until an admin approves the account.
  if (data.profile.approvalStatus === 'pending') {
    return (
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Services</h2>
        <div style={styles.pendingBanner} role="status">
          <strong>Your account is pending approval.</strong>
          <span>
            {' '}An admin will review your sign-in shortly. Once approved you'll be
            able to request a League email and Claude seat here.
          </span>
        </div>
      </div>
    );
  }

  const workspaceBaseline = hasWorkspaceBaseline(data);

  // "Live" ExternalAccounts — status active/pending. Removed/suspended rows
  // shouldn't block re-requesting.
  const liveStatuses = (s: string) => s === 'active' || s === 'pending';

  // Derive workspace state.
  const workspaceAccount = data.externalAccounts.find(
    (a) => a.type === 'workspace' && liveStatuses(a.status),
  );
  // Only *pending* requests block re-requesting. Rejected requests still show
  // up in the status column so the student knows what happened, but they
  // don't lock the button forever. A *rejected_permanent* request blocks
  // forever (admin decision).
  const pendingWorkspaceRequest = data.provisioningRequests.find(
    (r) =>
      (r.requestedType === 'workspace' || r.requestedType === 'workspace_and_claude') &&
      r.status === 'pending',
  );
  const permaRejectedWorkspace = data.provisioningRequests.some(
    (r) =>
      (r.requestedType === 'workspace' || r.requestedType === 'workspace_and_claude') &&
      r.status === 'rejected_permanent',
  );
  const latestWorkspaceRequest = data.provisioningRequests.find(
    (r) => r.requestedType === 'workspace' || r.requestedType === 'workspace_and_claude',
  );

  // Derive claude state.
  const claudeAccount = data.externalAccounts.find(
    (a) => a.type === 'claude' && liveStatuses(a.status),
  );
  const pendingClaudeRequest = data.provisioningRequests.find(
    (r) =>
      (r.requestedType === 'claude' || r.requestedType === 'workspace_and_claude') &&
      r.status === 'pending',
  );
  const permaRejectedClaude = data.provisioningRequests.some(
    (r) =>
      (r.requestedType === 'claude' || r.requestedType === 'workspace_and_claude') &&
      r.status === 'rejected_permanent',
  );
  const latestClaudeRequest = data.provisioningRequests.find(
    (r) => r.requestedType === 'claude' || r.requestedType === 'workspace_and_claude',
  );

  // Derive pike13 state.
  const pike13Account = data.externalAccounts.find((a) => a.type === 'pike13');

  const hasActiveOrPendingWorkspace =
    workspaceAccount != null || pendingWorkspaceRequest != null;
  const hasActiveOrPendingClaude =
    claudeAccount != null || pendingClaudeRequest != null;

  // Claude seats are invited to the student's League email, so:
  //   - The student must already have a workspace baseline (so a League
  //     email exists for them).
  //   - The student must be signed in under that League email (primaryEmail
  //     is @*.jointheleague.org). Requesting from an external Google/GitHub
  //     session points the invite at the wrong identity.
  const signedInAsLeague = isLeagueEmail(data.profile.primaryEmail);
  const showWorkspaceButton = !hasActiveOrPendingWorkspace && !permaRejectedWorkspace;
  const showClaudeButton =
    !hasActiveOrPendingClaude &&
    !permaRejectedClaude &&
    workspaceBaseline &&
    signedInAsLeague;
  const claudeBlockedOnWorkspace =
    !hasActiveOrPendingClaude && !permaRejectedClaude && !workspaceBaseline;
  const claudeBlockedOnLogin =
    !hasActiveOrPendingClaude &&
    !permaRejectedClaude &&
    workspaceBaseline &&
    !signedInAsLeague;

  return (
    <div style={styles.card}>
      <h2 style={styles.sectionTitle}>Services</h2>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Service</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {/* League Email (workspace) */}
          <tr style={styles.tr}>
            <td style={styles.td}>League Email</td>
            <td style={styles.td}>
              {workspaceAccount
                ? workspaceAccount.status
                : latestWorkspaceRequest
                  ? `Request ${latestWorkspaceRequest.status}`
                  : 'None'}
            </td>
            <td style={styles.td}>
              {showWorkspaceButton ? (
                <button
                  onClick={() => onRequest('workspace')}
                  disabled={requesting}
                  style={styles.requestButton}
                  aria-label="Request League Email"
                >
                  Request League Email
                </button>
              ) : null}
            </td>
          </tr>

          {/* Claude Seat */}
          <tr style={styles.tr}>
            <td style={styles.td}>Claude Seat</td>
            <td style={styles.td}>
              {claudeAccount
                ? claudeAccount.status
                : latestClaudeRequest
                  ? `Request ${latestClaudeRequest.status}`
                  : 'None'}
            </td>
            <td style={styles.td}>
              {showClaudeButton ? (
                <button
                  onClick={() => onRequest('claude')}
                  disabled={requesting}
                  style={styles.requestButton}
                  aria-label="Request Claude Seat"
                >
                  Request Claude Seat
                </button>
              ) : claudeBlockedOnWorkspace ? (
                <span
                  style={styles.disabledHint}
                  title="A League Email account is required before requesting a Claude seat"
                  aria-label="Claude Seat requires a League Email account first"
                >
                  Requires League Email
                </span>
              ) : claudeBlockedOnLogin ? (
                <span
                  style={styles.disabledHint}
                  title="Sign in with your League email to request a Claude seat"
                  aria-label="Sign in with your League email to request a Claude seat"
                >
                  Sign in with your League email
                </span>
              ) : null}
            </td>
          </tr>

          {/* Pike13 */}
          <tr style={styles.tr}>
            <td style={styles.td}>Pike13</td>
            <td style={styles.td}>
              {pike13Account ? pike13Account.status : 'None'}
            </td>
            <td style={styles.td}>
              <span style={styles.readOnlyHint}>Managed by staff</span>
            </td>
          </tr>
        </tbody>
      </table>

      {requestError && (
        <p role="alert" style={styles.inlineError}>{requestError}</p>
      )}
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

  const requestMutation = useMutation({
    mutationFn: postProvisioningRequest,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['account'] });
    },
  });

  // Admin redirect — to the provisioning-requests page (has actual admin UI).
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

      <ProfileSection profile={data.profile} />

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

      <ServicesSection
        data={data}
        onRequest={(requestType) => requestMutation.mutate(requestType)}
        requesting={requestMutation.isPending}
        requestError={
          requestMutation.isError
            ? requestMutation.error instanceof Error
              ? requestMutation.error.message
              : 'Request failed'
            : null
        }
      />

      <div style={styles.spacer} />

      <ClaudeCodeSection data={data} />

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
