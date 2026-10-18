/**
 * AccountLlmProxyCard — the tight student-facing "LLM Proxy" card
 * (sprint 003, ticket 004; originally Sprint 013 T006).
 *
 * Fetches GET /api/account/llm-proxy and shows one row of figures
 * (`$x.xx of $y.yy this month · resets <date>`, or `n / m tokens` for a
 * legacy token with no dollar budget), the status, the masked key with a
 * Copy button, and one button "Set up and details" that opens /llm-proxy.
 * No code blocks here — the examples live on the page.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  deriveStatus,
  maskToken,
  usageLine,
  type LlmProxyStatusKind,
} from '../../lib/llm-proxy-format';

export interface LlmProxyStatus {
  enabled: boolean;
  endpoint: string;
  /** Plaintext bearer token (short-lived, budget-capped, demo-scoped). */
  token?: string | null;
  tokensUsed?: number;
  tokenLimit?: number;
  requestCount?: number;
  budgetUsd?: number | null;
  spentUsd?: number | null;
  spentUsdTotal?: number | null;
  periodResetsAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  grantedAt?: string;
  models?: string[];
  anthropicEnabled?: boolean;
  anthropicEndpoint?: string | null;
}

export async function fetchLlmProxyStatus(): Promise<LlmProxyStatus> {
  const res = await fetch('/api/account/llm-proxy');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<LlmProxyStatus>;
}

const STATUS_LABEL: Record<LlmProxyStatusKind, string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
  disabled: 'Disabled',
};

export default function AccountLlmProxyCard() {
  const { data: status, error: err } = useQuery<LlmProxyStatus>({
    queryKey: ['account', 'llm-proxy'],
    queryFn: fetchLlmProxyStatus,
  });

  async function copyToken() {
    if (!status?.token) return;
    try {
      await navigator.clipboard.writeText(status.token);
    } catch {
      /* ignore */
    }
  }

  // Hide on fetch error: the feature is additive and must not break /account.
  if (err) return null;

  if (!status) {
    return (
      <section data-testid="account-llm-proxy-card" style={styles.card}>
        <h2 style={styles.sectionTitle}>LLM Proxy</h2>
        <p style={styles.muted}>Loading…</p>
      </section>
    );
  }

  if (!status.enabled || !status.token) {
    return (
      <section data-testid="account-llm-proxy-card" style={styles.card}>
        <h2 style={styles.sectionTitle}>LLM Proxy</h2>
        <p style={styles.muted} data-testid="llm-proxy-not-enabled">
          <em>Not enabled.</em> Ask an instructor.
        </p>
      </section>
    );
  }

  const kind = deriveStatus(status);

  return (
    <section data-testid="account-llm-proxy-card" style={styles.card}>
      <h2 style={styles.sectionTitle}>LLM Proxy</h2>

      <div style={styles.row}>
        <span data-testid="llm-proxy-usage" style={styles.figures}>
          {usageLine(status)}
        </span>
        <span
          data-testid="llm-proxy-status"
          style={{ ...styles.pill, ...(kind === 'active' ? styles.pillActive : styles.pillInactive) }}
        >
          {STATUS_LABEL[kind]}
        </span>
        {status.requestCount !== undefined && (
          <span style={styles.muted}>{status.requestCount} requests</span>
        )}
      </div>

      <div style={styles.row}>
        <span style={styles.label}>Key</span>
        <code data-testid="llm-proxy-token" style={styles.tokenValue} title="Your proxy key">
          {maskToken(status.token)}
        </code>
        <button
          type="button"
          onClick={copyToken}
          style={styles.copyBtn}
          aria-label="Copy key to clipboard"
        >
          Copy
        </button>
      </div>

      <div style={styles.actions}>
        <Link to="/llm-proxy" style={styles.primaryBtn} data-testid="llm-proxy-setup-link">
          Set up and details
        </Link>
      </div>
    </section>
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
    fontSize: '1.1rem',
    fontWeight: 600,
    margin: '0 0 0.75rem 0',
    color: '#1e293b',
  },
  muted: {
    color: '#64748b',
    margin: '0.25rem 0',
    fontSize: '0.85rem',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.6rem',
    margin: '0.35rem 0',
  },
  figures: {
    fontWeight: 600,
    color: '#1e293b',
  },
  label: {
    fontWeight: 600,
    color: '#475569',
    fontSize: '0.85rem',
  },
  pill: {
    fontSize: '0.72rem',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 999,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  pillActive: { background: '#d1fae5', color: '#065f46' },
  pillInactive: { background: '#e2e8f0', color: '#475569' },
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
  },
  actions: { marginTop: '0.9rem' },
  primaryBtn: {
    display: 'inline-block',
    fontSize: '0.85rem',
    fontWeight: 600,
    padding: '0.4rem 0.9rem',
    borderRadius: 6,
    background: '#2563eb',
    color: '#fff',
    textDecoration: 'none',
  },
};
