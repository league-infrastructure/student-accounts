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
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { hasStaffAccess } from '../lib/roles';
import { useAccountEventStream } from '../hooks/useAccountEventStream';
import UsernamePasswordSection from './account/UsernamePasswordSection';
import ConfirmDialog from '../components/ConfirmDialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccountProfile {
  id: number;
  displayName: string | null;
  primaryEmail: string;
  /** User-chosen address for outbound mail; null = use primaryEmail. */
  notificationEmail?: string | null;
  /** All addresses owned by this user (primary + each linked provider's
   *  email + workspace external_id). The Account page renders this as a
   *  picker so the student can choose which one is the notification email. */
  availableEmails?: string[];
  cohort: { id: number; name: string } | null;
  role: string;
  approvalStatus?: 'approved' | 'pending';
  createdAt: string;
  /** Shared one-shot temp password for the League account (only set when
   *  the user has a live workspace ExternalAccount). */
  workspaceTempPassword?: string | null;
  /** True when the student has an active LLM proxy token. */
  llmProxyEnabled?: boolean;
  /** Number of non-disabled OAuth clients owned by this user. */
  oauthClientCount?: number;
  /** When the user has an active LLM proxy token, plaintext + endpoint URL. */
  llmProxy?: { token: string | null; endpoint: string } | null;
  /** Username for passphrase / local login, or null if not set. */
  username?: string | null;
  /** True when a password_hash is stored for this account. */
  has_password?: boolean;
  /** Per-user permission flags (sprint 027). Drive sidebar visibility +
   *  feature gates on the client; server enforces them on every API call. */
  allowsOauthClient?: boolean;
  allowsLlmProxy?: boolean;
  allowsLeagueAccount?: boolean;
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

async function patchNotificationEmail(notificationEmail: string | null): Promise<void> {
  const res = await fetch('/api/account/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notificationEmail }),
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
  onChangeNotificationEmail,
}: {
  profile: AccountProfile;
  onRename: (newName: string) => Promise<void>;
  onChangeNotificationEmail: (email: string | null) => Promise<void>;
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
      <NotificationEmailPicker
        profile={profile}
        onChange={onChangeNotificationEmail}
      />
      <div style={styles.profileMeta}>{subtitle}</div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// NotificationEmailPicker — click the current email, get a dropdown of all
// addresses on the account; selection PATCHes notification_email server-side.
// ---------------------------------------------------------------------------

function NotificationEmailPicker({
  profile,
  onChange,
}: {
  profile: AccountProfile;
  onChange: (email: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = profile.availableEmails ?? [profile.primaryEmail];
  const current = profile.notificationEmail ?? profile.primaryEmail;

  // If only one possible email, no point in a picker — render flat.
  if (choices.length <= 1) {
    return <div style={styles.profileMeta}>{current}</div>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setEditing(true);
        }}
        style={styles.profileEmailButton}
        title="Click to choose which email gets notifications"
        aria-label={`Notification email (currently ${current}). Click to change.`}
      >
        {current}
        <span style={{ marginLeft: 6, fontSize: 11, color: '#94a3b8' }}>▾</span>
      </button>
    );
  }

  return (
    <>
      <select
        autoFocus
        defaultValue={current}
        disabled={saving}
        onBlur={() => setEditing(false)}
        onChange={async (e) => {
          const next = e.target.value;
          if (next === current) {
            setEditing(false);
            return;
          }
          setSaving(true);
          setError(null);
          try {
            // Sending primaryEmail as notification clears it (null on server).
            const value = next === profile.primaryEmail ? null : next;
            await onChange(value);
            setEditing(false);
          } catch (err: any) {
            setError(err.message ?? 'Could not save');
          } finally {
            setSaving(false);
          }
        }}
        style={styles.profileEmailSelect}
        aria-label="Choose notification email"
      >
        {choices.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
      {error && <div style={styles.profileNameError} role="alert">{error}</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// LoginsSection
// ---------------------------------------------------------------------------

/* ---- Provider logos — visual parity with the Login page ---- */

function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8a12 12 0 1 1 7.9-21l5.7-5.7A20 20 0 1 0 24 44c11 0 20-9 20-20 0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.7 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3a12 12 0 0 1-7.3 2.5c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.5l6.3 5.3c-.4.4 6.5-4.8 6.5-14.8 0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  );
}

function GitHubLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.7-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.3-3.2-.1-.4-.6-1.6.1-3.3 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.3.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.3v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/>
    </svg>
  );
}

function Pike13Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 36 40" fill="currentColor" aria-hidden="true">
      <path d="M20.04 18.85L11.08 13.76L35.15 0.11C35.60 -0.15 35.98 0.06 35.98 0.58L36.00 8.86C36.01 9.37 35.63 10.00 35.18 10.26L20.04 18.85ZM0 22.27L7.01 26.24L0.86 29.73C0.40 29.99 0.03 29.78 0.02 29.26L0 22.27Z"/>
      <path d="M0.86 10.27L35.17 29.74C35.63 30.00 36.00 30.63 36.00 31.15L35.98 39.42C35.98 39.94 35.60 40.15 35.14 39.89L0.83 20.43C0.37 20.17 0 19.53 0 19.02L0.02 10.74C0.03 10.22 0.40 10.01 0.86 10.27Z"/>
    </svg>
  );
}

interface LoginsSectionProps {
  logins: AccountLogin[];
  role: string | undefined;
  onRemoveError: string | null;
  onRemove: (login: AccountLogin) => void;
  removingId: number | null;
}

function LoginsSection({ logins, role, onRemoveError, onRemove, removingId }: LoginsSectionProps) {
  const canRemove = logins.length > 1;
  const hasPike13 = logins.some((l) => l.provider === 'pike13');
  // /api/auth/me maps DB role 'student' → client role 'USER'; staff and admin
  // come through as 'STAFF' and 'ADMIN'. Pike 13 is for staff/admin onboarding;
  // students never see the link button.
  const isStudent = !hasStaffAccess(role);
  const showPike13 = !hasPike13 && !isStudent;

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
                    onClick={() => onRemove(login)}
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

      {/* Add buttons — same horizontal brand-icon layout as the Login page.
          Google and GitHub allow multiple logins per provider so they always
          render. Pike 13 is one-per-account and hidden once linked. If a
          provider's OAuth env isn't configured, the server returns 501 with
          setup instructions when the user clicks. */}
      <div style={styles.addRow}>
        <a
          href="/api/auth/google?link=1"
          aria-label="Add Google"
          style={{ ...styles.addButton, ...styles.addButtonGoogle }}
        >
          <GoogleLogo />
        </a>
        <a
          href="/api/auth/github?link=1"
          aria-label="Add GitHub"
          style={{ ...styles.addButton, ...styles.addButtonGitHub }}
        >
          <GitHubLogo />
        </a>
        {showPike13 && (
          <a
            href="/api/auth/pike13?link=1"
            aria-label="Add Pike 13"
            style={{ ...styles.addButton, ...styles.addButtonPike13 }}
          >
            <Pike13Logo />
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
// FeaturesSection — quick-glance at the user's enabled features (OAuth
// Clients count + LLM Proxy access). Each row links to the full page.
// Hidden rows mean the feature isn't enabled for this user.
// ---------------------------------------------------------------------------

function FeaturesSection({ profile }: { profile: AccountProfile }) {
  const oauthCount = profile.oauthClientCount ?? 0;
  const showOauth = profile.allowsOauthClient || oauthCount > 0;
  const showLlm = !!profile.llmProxy;

  if (!showOauth && !showLlm) return null;

  return (
    <div style={styles.card} data-testid="features-section">
      <h2 style={styles.sectionTitle}>Features</h2>

      {showOauth && (
        <div style={styles.featureRow} data-testid="feature-oauth">
          <div style={styles.featureLabel}>OAuth Clients</div>
          <div style={styles.featureBody}>
            {oauthCount > 0 ? (
              <Link to="/oauth-clients" style={styles.featureLink}>
                You have {oauthCount} OAuth client{oauthCount === 1 ? '' : 's'}
              </Link>
            ) : (
              <Link to="/oauth-clients" style={styles.featureLink}>
                Create an OAuth client
              </Link>
            )}
          </div>
        </div>
      )}

      {showLlm && profile.llmProxy && (
        <div style={styles.featureRow} data-testid="feature-llm-proxy">
          <div style={styles.featureLabel}>LLM Proxy</div>
          <div style={styles.featureBody}>
            <Link to="/llm-proxy" style={styles.featureLink}>
              You have access
            </Link>
            <div style={styles.featureMeta}>
              <span style={styles.featureMetaKey}>endpoint:</span>{' '}
              <code>{profile.llmProxy.endpoint}</code>
            </div>
            {profile.llmProxy.token && (
              <div style={styles.featureMeta}>
                <span style={styles.featureMetaKey}>key:</span>{' '}
                <code style={styles.featureToken}>{profile.llmProxy.token}</code>
              </div>
            )}
          </div>
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

  // Confirmation dialog state for login removal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingLogin, setPendingLogin] = useState<AccountLogin | null>(null);

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
    // Always refetch on mount so a freshly-linked provider (returning from
    // /api/auth/<provider>/callback) shows up immediately instead of the
    // stale pre-link snapshot.
    refetchOnMount: 'always',
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

  const isPending = data?.profile.approvalStatus === 'pending';

  // Pending-approval state: show only the waiting-for-approval card. The
  // useQuery polls every 5s while pending, so the page auto-refreshes the
  // moment an admin approves.
  if (isPending) {
    return (
      <div style={styles.container}>
        <h1 style={styles.pageTitle}>My Account</h1>
        <div style={styles.card} data-testid="pending-approval-card">
          <h2 style={styles.sectionTitle}>Waiting for approval</h2>
          <p style={styles.helpText}>
            Your account is pending review. An admin or staff member will
            approve it shortly. This page will refresh automatically once
            your account is approved.
          </p>
        </div>
      </div>
    );
  }

  // Surface OAuth-link callback errors via ?error=… on the URL.
  const linkError = (() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('error');
    if (code === 'already_linked') {
      return 'That provider account is already linked to a different user. Sign in as that user to manage it, or use a different provider account.';
    }
    if (code === 'oauth_denied') {
      return 'Sign-in was cancelled or failed. Try again.';
    }
    return null;
  })();

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>My Account</h1>

      {linkError && (
        <div role="alert" style={styles.linkErrorBanner} data-testid="link-error-banner">
          {linkError}
        </div>
      )}

      {/* Identity sections: Profile, Logins, UsernamePassword — all roles */}
      <>
        <ProfileSection
          profile={data.profile}
          onRename={async (newName) => {
            await patchDisplayName(newName);
            await queryClient.invalidateQueries({ queryKey: ['account'] });
          }}
          onChangeNotificationEmail={async (email) => {
            await patchNotificationEmail(email);
            await queryClient.invalidateQueries({ queryKey: ['account'] });
          }}
        />

        <div style={styles.spacer} />

        <FeaturesSection profile={data.profile} />

        <div style={styles.spacer} />

        <LoginsSection
          logins={data.logins}
          role={user?.role}
          onRemoveError={
            removeLoginMutation.isError
              ? removeLoginMutation.error instanceof Error
                ? removeLoginMutation.error.message
                : 'Failed to remove login'
              : null
          }
          onRemove={(login) => {
            setPendingLogin(login);
            setConfirmOpen(true);
          }}
          removingId={removeLoginMutation.isPending ? (removeLoginMutation.variables ?? null) : null}
        />

        <ConfirmDialog
          open={confirmOpen}
          title="Remove login"
          message={
            pendingLogin
              ? `Remove the ${providerLabel(pendingLogin.provider)} login from your account? You can re-link it later by clicking Add ${providerLabel(pendingLogin.provider)}.`
              : ''
          }
          confirmLabel="Remove"
          cancelLabel="Cancel"
          danger
          onConfirm={() => {
            if (pendingLogin !== null) {
              removeLoginMutation.mutate(pendingLogin.id);
            }
            setConfirmOpen(false);
            setPendingLogin(null);
          }}
          onCancel={() => {
            setConfirmOpen(false);
            setPendingLogin(null);
          }}
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
  linkErrorBanner: {
    border: '1px solid #fca5a5',
    background: '#fef2f2',
    color: '#7f1d1d',
    borderRadius: 8,
    padding: '12px 16px',
    fontSize: '0.9rem',
    marginBottom: '1rem',
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
  profileEmailButton: {
    fontSize: '0.9rem',
    color: '#475569',
    marginBottom: 2,
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    textAlign: 'left' as const,
    font: 'inherit',
  },
  profileEmailSelect: {
    fontSize: '0.9rem',
    color: '#1e293b',
    marginBottom: 2,
    padding: '2px 6px',
    border: '1px solid #cbd5e1',
    borderRadius: 4,
    background: '#fff',
    maxWidth: 420,
  },
  featureRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '1rem',
    padding: '0.5rem 0',
    borderTop: '1px solid #f1f5f9',
  },
  featureLabel: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: '#475569',
    minWidth: 120,
    flexShrink: 0,
  },
  featureBody: {
    flex: 1,
    fontSize: '0.9rem',
  },
  featureLink: {
    color: '#2563eb',
    textDecoration: 'none',
    fontWeight: 500,
  },
  featureMeta: {
    fontSize: '0.78rem',
    color: '#64748b',
    marginTop: 4,
    wordBreak: 'break-all' as const,
  },
  featureMetaKey: {
    color: '#94a3b8',
  },
  featureToken: {
    background: '#f1f5f9',
    padding: '1px 6px',
    borderRadius: 3,
    fontSize: '0.78rem',
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
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 0',
    borderRadius: 8,
    textDecoration: 'none',
    cursor: 'pointer',
  },
  addButtonGoogle: {
    background: '#fff',
    color: '#374151',
    border: '1px solid #d1d5db',
  },
  addButtonGitHub: {
    background: '#24292e',
    color: '#fff',
  },
  addButtonPike13: {
    background: '#00833D',
    color: '#fff',
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
