/**
 * LlmProxy page — mounted at /llm-proxy under AppLayout (sprint 003,
 * ticket 004; first extracted in Sprint 021, ticket 002).
 *
 * Header: key (masked, Show/Copy), endpoint (Copy), usage meter in dollars
 * (tokens for a legacy token), reset date, request count, status. Below it
 * the shared LlmProxySetupExamples with one tab per tool. Data comes from
 * GET /api/account/llm-proxy, which also supplies the tier list (`models`)
 * and the Anthropic flag/endpoint that gate the Claude Code tab.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import LlmProxySetupExamples from '../components/LlmProxySetupExamples';
import {
  fetchLlmProxyStatus,
  type LlmProxyStatus,
} from './account/AccountLlmProxyCard';
import {
  deriveStatus,
  formatShortDate,
  maskToken,
  usageLine,
  usagePercent,
} from '../lib/llm-proxy-format';

export default function LlmProxy() {
  const { data: status, error: err } = useQuery<LlmProxyStatus>({
    queryKey: ['account', 'llm-proxy'],
    queryFn: fetchLlmProxyStatus,
  });
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState<'token' | 'endpoint' | null>(null);

  async function copy(what: 'token' | 'endpoint', value: string | null | undefined) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>LLM Proxy</h1>
      {renderBody()}
    </div>
  );

  function renderBody() {
    // Hide gracefully on fetch error (same as the Account card).
    if (err) return null;

    if (!status) {
      return (
        <section data-testid="account-llm-proxy-card" style={styles.card}>
          <p style={styles.muted}>Loading…</p>
        </section>
      );
    }

    if (!status.enabled || !status.token) {
      return (
        <section data-testid="account-llm-proxy-card" style={styles.card}>
          <p style={styles.muted} data-testid="llm-proxy-not-enabled">
            <em>Not enabled.</em> Ask an instructor.
          </p>
        </section>
      );
    }

    const kind = deriveStatus(status);
    const pct = usagePercent(status);

    return (
      <>
        <section data-testid="account-llm-proxy-card" style={styles.card}>
          <dl style={styles.dl}>
            <dt style={styles.dt}>Key</dt>
            <dd style={styles.dd}>
              <code data-testid="llm-proxy-token" style={styles.tokenValue}>
                {showToken ? status.token : maskToken(status.token)}
              </code>{' '}
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                style={styles.copyBtn}
                aria-label={showToken ? 'Hide key' : 'Show key'}
              >
                {showToken ? 'Hide' : 'Show'}
              </button>{' '}
              <button
                type="button"
                onClick={() => copy('token', status.token)}
                style={styles.copyBtn}
                aria-label="Copy key to clipboard"
              >
                {copied === 'token' ? 'Copied' : 'Copy'}
              </button>
            </dd>

            <dt style={styles.dt}>Endpoint</dt>
            <dd style={styles.dd}>
              <code data-testid="llm-proxy-endpoint">{status.endpoint}</code>{' '}
              <button
                type="button"
                onClick={() => copy('endpoint', status.endpoint)}
                style={styles.copyBtn}
                aria-label="Copy endpoint to clipboard"
              >
                {copied === 'endpoint' ? 'Copied' : 'Copy'}
              </button>
            </dd>

            <dt style={styles.dt}>Usage</dt>
            <dd style={styles.dd}>
              <div
                style={styles.quotaBarBg}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct)}
              >
                <div style={{ ...styles.quotaBarFill, width: `${pct}%` }} />
              </div>
              <span data-testid="llm-proxy-usage">{usageLine(status)}</span>
              {status.requestCount !== undefined && (
                <> · {status.requestCount} requests</>
              )}
            </dd>

            {status.budgetUsd != null && (
              <>
                <dt style={styles.dt}>Resets</dt>
                <dd style={styles.dd} data-testid="llm-proxy-resets">
                  {formatShortDate(status.periodResetsAt)}
                </dd>
              </>
            )}

            <dt style={styles.dt}>Status</dt>
            <dd style={styles.dd} data-testid="llm-proxy-status">
              {kind.charAt(0).toUpperCase() + kind.slice(1)}
              {status.expiresAt && (
                <span style={styles.muted}>
                  {' '}
                  · {kind === 'expired' ? 'expired' : 'expires'}{' '}
                  {new Date(status.expiresAt).toLocaleDateString()}
                </span>
              )}
            </dd>
          </dl>
        </section>

        <section style={{ ...styles.card, marginTop: '1rem' }}>
          <h2 style={styles.sectionTitle}>Set up your tool</h2>
          <p style={styles.muted}>
            Each example already has your key and endpoint. Model tiers:{' '}
            {(status.models ?? ['league-large', 'league-medium', 'league-small']).map((m, i) => (
              <span key={m}>
                {i > 0 && ' · '}
                <code>{m}</code>
              </span>
            ))}
            .
          </p>
          <LlmProxySetupExamples
            endpoint={status.endpoint}
            token={status.token}
            models={status.models}
            anthropicEnabled={!!status.anthropicEnabled}
            anthropicEndpoint={status.anthropicEndpoint}
          />
        </section>
      </>
    );
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 760,
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
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: '0.5rem',
    marginTop: 0,
  },
  muted: {
    color: '#64748b',
    margin: '0.25rem 0',
    fontSize: '0.85rem',
  },
  dl: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    columnGap: '1rem',
    rowGap: '0.5rem',
    margin: 0,
    alignItems: 'center',
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
};
