/**
 * ServicesPage — external-service status for students.
 *
 * Mounted at /services under AppLayout (Sprint 020, ticket 005).
 *
 * Consolidates the three sections previously rendered on Account.tsx:
 *  - ServicesSection   — Workspace / Google email status + temp password
 *  - ClaudeCodeSection — Claude Code onboarding instructions
 *  - AccountLlmProxyCard — LLM proxy token status and setup snippets
 *
 * Conditional rendering per role + entitlements:
 *  - Workspace block  : students with a workspace ExternalAccount (or a
 *    league email), OR pending accounts (banner variant).
 *  - Claude Code block: students who have a claude ExternalAccount.
 *  - LLM Proxy block  : students whose account includes llmProxyEnabled
 *    (proxy token is active) — the card itself renders either the full
 *    quota view or a "not enabled" note.
 *
 * If none of the three sections applies, a friendly empty-state card is
 * shown instead.
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import type { AccountData, AccountProfile } from './Account';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchAccount(): Promise<AccountData> {
  const res = await fetch('/api/account');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Failed to load account (${res.status})`,
    );
  }
  return res.json() as Promise<AccountData>;
}

interface LlmProxyStatus {
  enabled: boolean;
  endpoint: string;
  token?: string | null;
  tokensUsed?: number;
  tokenLimit?: number;
  requestCount?: number;
  expiresAt?: string;
  grantedAt?: string;
}

async function fetchLlmProxyStatus(): Promise<LlmProxyStatus> {
  const res = await fetch('/api/account/llm-proxy');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<LlmProxyStatus>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** League emails are @jointheleague.org or any subdomain. */
function isLeagueEmail(email: string): boolean {
  return /@([a-z0-9-]+\.)?jointheleague\.org$/i.test(email);
}

// ---------------------------------------------------------------------------
// ServicesSection (Workspace / Google services status)
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
        Accounts are granted by an admin. If something you expect is missing,
        reach out to your instructor.
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
                      password:{' '}
                      <code style={styles.emailValue}>
                        {data.profile.workspaceTempPassword}
                      </code>
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
// ClaudeCodeSection
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
          Claude access is not currently available on your account (
          {claudeAccount.status}). Contact the League admin if this looks wrong.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LlmProxySection (uses its own query — mirrors AccountLlmProxyCard)
// ---------------------------------------------------------------------------

function LlmProxySection() {
  const { data: status, error: err } = useQuery<LlmProxyStatus>({
    queryKey: ['account', 'llm-proxy'],
    queryFn: fetchLlmProxyStatus,
  });

  async function copyEndpoint() {
    if (!status?.endpoint) return;
    try {
      await navigator.clipboard.writeText(status.endpoint);
    } catch {
      /* ignore */
    }
  }

  async function copyToken() {
    if (!status?.token) return;
    try {
      await navigator.clipboard.writeText(status.token);
    } catch {
      /* ignore */
    }
  }

  // Hide gracefully on fetch error — same behaviour as AccountLlmProxyCard.
  if (err) return null;

  if (!status) {
    return (
      <section data-testid="account-llm-proxy-card" style={styles.card}>
        <h2 style={styles.sectionTitle}>LLM Proxy</h2>
        <p style={styles.muted}>Loading…</p>
      </section>
    );
  }

  if (!status.enabled) {
    return (
      <section data-testid="account-llm-proxy-card" style={styles.card}>
        <h2 style={styles.sectionTitle}>LLM Proxy</h2>
        <p style={styles.muted}>
          <em>Not enabled.</em> Ask an admin to grant LLM proxy access for your
          account.
        </p>
      </section>
    );
  }

  const tokensUsed = status.tokensUsed ?? 0;
  const tokenLimit = status.tokenLimit ?? 0;
  const remaining = Math.max(0, tokenLimit - tokensUsed);
  const pct = tokenLimit > 0 ? Math.min(100, (tokensUsed / tokenLimit) * 100) : 0;

  return (
    <section data-testid="account-llm-proxy-card" style={styles.card}>
      <h2 style={styles.sectionTitle}>LLM Proxy</h2>

      <dl style={styles.dl}>
        <dt style={styles.dt}>Endpoint</dt>
        <dd style={styles.dd}>
          <code data-testid="llm-proxy-endpoint">{status.endpoint}</code>{' '}
          <button type="button" onClick={copyEndpoint} style={styles.copyBtn}>
            Copy
          </button>
        </dd>
        {status.token && (
          <>
            <dt style={styles.dt}>Token</dt>
            <dd style={styles.dd}>
              <code data-testid="llm-proxy-token" style={styles.tokenValue}>
                {status.token}
              </code>{' '}
              <button type="button" onClick={copyToken} style={styles.copyBtn}>
                Copy
              </button>
            </dd>
          </>
        )}
        <dt style={styles.dt}>Usage</dt>
        <dd style={styles.dd}>
          <div style={styles.quotaBarBg}>
            <div
              style={{
                ...styles.quotaBarFill,
                width: `${pct}%`,
              }}
            />
          </div>
          {tokensUsed.toLocaleString()} / {tokenLimit.toLocaleString()} tokens
          used · <strong>{remaining.toLocaleString()}</strong> remaining
          {status.requestCount !== undefined && (
            <> · {status.requestCount} requests</>
          )}
        </dd>
        <dt style={styles.dt}>Expires</dt>
        <dd style={styles.dd}>
          {status.expiresAt
            ? new Date(status.expiresAt).toLocaleString()
            : '—'}
        </dd>
      </dl>

      <h3 style={styles.subTitle}>Using your token</h3>
      {!status.token && (
        <p style={styles.muted}>
          Your token isn&apos;t showing because it was granted before we stored
          the plaintext value. Ask an admin to revoke and re-grant your access.
        </p>
      )}
      <pre style={styles.snippet}>
{`# Claude Code
export ANTHROPIC_BASE_URL="${status.endpoint}"
export ANTHROPIC_API_KEY="${status.token ?? 'llmp_…'}"
# Allowed models: Sonnet or Haiku (specified in the request model field)
export ANTHROPIC_MODEL="claude-sonnet-4-6"
export ANTHROPIC_SMALL_FAST_MODEL="claude-haiku-4-5-20251001"
claude

# curl — the proxy automatically maps model strings to allowed versions
# Any string containing "Sonnet" → claude-sonnet-4-6
# Any string containing "Haiku" → claude-haiku-4-5-20251001
curl -X POST "${status.endpoint}/v1/messages" \\
  -H "x-api-key: ${status.token ?? 'llmp_…'}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{"model":"claude-sonnet-4-6","max_tokens":1024,
       "messages":[{"role":"user","content":"hi"}]}'`}
      </pre>
    </section>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div style={styles.card} data-testid="services-empty-state">
      <p style={styles.emptyText}>
        No external services are linked to your account yet.
      </p>
      <p style={styles.emptySubText}>
        Contact your instructor or the League admin if you expect to have
        services configured.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Predicates — mirror the old Account.tsx gating logic
// ---------------------------------------------------------------------------

/** True when the Services (workspace) block should render. */
function shouldShowServices(data: AccountData): boolean {
  if (data.profile.approvalStatus === 'pending') return true;
  const hasWorkspace = data.externalAccounts.some((a) => a.type === 'workspace');
  return hasWorkspace || isLeagueEmail(data.profile.primaryEmail);
}

/** True when the Claude Code block should render. */
function shouldShowClaude(data: AccountData): boolean {
  return data.externalAccounts.some((a) => a.type === 'claude');
}

/** True when the LLM Proxy block should render.
 *  The card itself handles the enabled/disabled variant. */
function shouldShowLlmProxy(profile: AccountProfile): boolean {
  return profile.llmProxyEnabled === true;
}

// ---------------------------------------------------------------------------
// ServicesPage — main component
// ---------------------------------------------------------------------------

export default function Services() {
  const { user } = useAuth();
  const role = user?.role?.toLowerCase();
  const isStudent = role === 'student';

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<AccountData>({
    queryKey: ['account'],
    queryFn: fetchAccount,
    enabled: isStudent,
    refetchInterval: (query) =>
      query.state.data?.profile.approvalStatus === 'pending' ? 5000 : false,
  });

  // Loading skeleton
  if (isStudent && isLoading) {
    return (
      <div style={styles.container}>
        <h1 style={styles.pageTitle}>Services</h1>
        <div style={styles.loadingCard} aria-busy="true" aria-label="Loading services">
          <div style={styles.skeletonLine} />
          <div style={{ ...styles.skeletonLine, width: '60%' }} />
          <div style={{ ...styles.skeletonLine, width: '80%' }} />
        </div>
      </div>
    );
  }

  // Error state
  if (isStudent && (isError || !data)) {
    return (
      <div style={styles.container}>
        <h1 style={styles.pageTitle}>Services</h1>
        <div style={styles.errorCard}>
          <p role="alert" style={styles.errorText}>
            {error instanceof Error ? error.message : 'Failed to load account data.'}
          </p>
          <button
            onClick={() => void refetch()}
            style={styles.retryButton}
            aria-label="Retry loading services"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Non-student users see a simple empty state — services are student-only
  // (staff/admin do not have workspace / claude / llm-proxy entitlements on
  // this account system).
  if (!isStudent || !data) {
    return (
      <div style={styles.container}>
        <h1 style={styles.pageTitle}>Services</h1>
        <EmptyState />
      </div>
    );
  }

  const showServices = shouldShowServices(data);
  const showClaude = shouldShowClaude(data);
  const showLlmProxy = shouldShowLlmProxy(data.profile);
  const showAny = showServices || showClaude || showLlmProxy;

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Services</h1>

      {!showAny && <EmptyState />}

      {showServices && (
        <>
          <ServicesSection data={data} />
          <div style={styles.spacer} />
        </>
      )}

      {showClaude && (
        <>
          <ClaudeCodeSection data={data} />
          <div style={styles.spacer} />
        </>
      )}

      {showLlmProxy && (
        <>
          <LlmProxySection />
          <div style={styles.spacer} />
        </>
      )}
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
  helpText: {
    fontSize: '0.9rem',
    color: '#374151',
    marginBottom: '0.5rem',
    lineHeight: 1.6,
  },
  helpLink: {
    color: '#4f46e5',
  },
  emptyText: {
    fontSize: '1rem',
    color: '#475569',
    margin: 0,
    fontWeight: 500,
  },
  emptySubText: {
    fontSize: '0.875rem',
    color: '#64748b',
    marginTop: '0.5rem',
    marginBottom: 0,
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
  // LlmProxySection styles
  muted: {
    color: '#64748b',
    margin: '0.25rem 0',
  },
  dl: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    columnGap: '1rem',
    rowGap: '0.4rem',
    margin: 0,
  },
  dt: {
    fontWeight: 600,
    color: '#475569',
  },
  dd: {
    margin: 0,
    color: '#1e293b',
  },
  copyBtn: {
    fontSize: '0.8rem',
    padding: '0.1rem 0.5rem',
    border: '1px solid #cbd5e1',
    borderRadius: 4,
    background: '#f8fafc',
    cursor: 'pointer',
  },
  tokenValue: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.82rem',
    padding: '2px 6px',
    background: '#f1f5f9',
    borderRadius: 4,
    userSelect: 'all' as const,
    wordBreak: 'break-all' as const,
  },
  subTitle: {
    fontSize: '0.95rem',
    fontWeight: 600,
    margin: '1rem 0 0.5rem 0',
    color: '#334155',
  },
  quotaBarBg: {
    width: '100%',
    height: 6,
    background: '#e2e8f0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: '0.3rem',
  },
  quotaBarFill: {
    height: '100%',
    background: '#2563eb',
  },
  snippet: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.8rem',
    background: '#0f172a',
    color: '#e2e8f0',
    padding: '0.8rem',
    borderRadius: 6,
    overflowX: 'auto',
  },
};
