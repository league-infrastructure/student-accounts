/**
 * ClaudeCode page — mounted at /claude-code under AppLayout.
 *
 * Extracted from ClaudeCodeSection in Services.tsx (Sprint 021, ticket 002).
 * Shows Claude Code onboarding instructions for students with a claude
 * ExternalAccount. Handles active, pending, and "access not available" states.
 * If no claude ExternalAccount exists (user reached the URL directly), shows a
 * brief "not enabled" message.
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import type { AccountData } from './Account';

// ---------------------------------------------------------------------------
// API helper
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

// ---------------------------------------------------------------------------
// ClaudeCode page
// ---------------------------------------------------------------------------

export default function ClaudeCode() {
  const { user } = useAuth();
  const role = user?.role?.toLowerCase();
  const isStudent = role === 'student';

  const { data, isLoading, isError, error, refetch } = useQuery<AccountData>({
    queryKey: ['account'],
    queryFn: fetchAccount,
    enabled: isStudent,
  });

  if (isStudent && isLoading) {
    return (
      <div style={styles.container}>
        <h1 style={styles.pageTitle}>Claude Code</h1>
        <div style={styles.loadingCard} aria-busy="true" aria-label="Loading Claude Code info">
          <div style={styles.skeletonLine} />
          <div style={{ ...styles.skeletonLine, width: '60%' }} />
        </div>
      </div>
    );
  }

  if (isStudent && (isError || !data)) {
    return (
      <div style={styles.container}>
        <h1 style={styles.pageTitle}>Claude Code</h1>
        <div style={styles.errorCard}>
          <p role="alert" style={styles.errorText}>
            {error instanceof Error ? error.message : 'Failed to load account data.'}
          </p>
          <button
            onClick={() => void refetch()}
            style={styles.retryButton}
            aria-label="Retry loading Claude Code info"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Non-students or no data: show not-enabled message
  if (!isStudent || !data) {
    return (
      <div style={styles.container}>
        <h1 style={styles.pageTitle}>Claude Code</h1>
        <div style={styles.card}>
          <p style={styles.helpText}>Claude Code is not enabled on your account.</p>
        </div>
      </div>
    );
  }

  const claudeAccount = data.externalAccounts.find((a) => a.type === 'claude');

  // No claude ExternalAccount — user reached URL directly despite sidebar being hidden
  if (!claudeAccount) {
    return (
      <div style={styles.container}>
        <h1 style={styles.pageTitle}>Claude Code</h1>
        <div style={styles.card}>
          <p style={styles.helpText}>Claude Code is not enabled on your account.</p>
        </div>
      </div>
    );
  }

  const active = claudeAccount.status === 'active';
  const pending = claudeAccount.status === 'pending';

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Claude Code</h1>
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
              The League&apos;s Anthropic org — no API key needed. Usage is billed to
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
                <code style={styles.code}>claude &quot;hello&quot;</code>
                <div style={styles.claudeHint}>
                  You should get a reply. If Claude Code asks for an API key,
                  you&apos;re signed into the wrong account — run{' '}
                  <code style={styles.codeInline}>claude auth logout</code> and
                  start over.
                </div>
              </li>
            </ol>
            <p style={styles.claudeFooter}>
              Your tokens refresh automatically — you won&apos;t need to log in again
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
