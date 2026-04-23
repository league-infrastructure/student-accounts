/**
 * AccountLlmProxyCard — student-facing "LLM Proxy" section on /account
 * (Sprint 013 T006).
 *
 * Fetches GET /api/account/llm-proxy and renders one of two states:
 *  - enabled: endpoint URL, quota bar, expiry, setup snippets.
 *  - disabled: "Not enabled — ask an admin to grant access".
 *
 * The plaintext token is NEVER fetched here. The student received the
 * token from an admin at grant time (T005 plaintext-once flow).
 */

import { useEffect, useState } from 'react';

interface LlmProxyStatus {
  enabled: boolean;
  endpoint: string;
  /** Plaintext bearer token. Shown directly on the page — these tokens
   *  are short-lived, quota-capped, and scoped to demo use. */
  token?: string | null;
  tokensUsed?: number;
  tokenLimit?: number;
  requestCount?: number;
  expiresAt?: string;
  grantedAt?: string;
}

export default function AccountLlmProxyCard() {
  const [status, setStatus] = useState<LlmProxyStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/account/llm-proxy');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as LlmProxyStatus;
        if (!cancelled) setStatus(body);
      } catch (e: any) {
        if (!cancelled) setErr(e.message ?? 'Failed to load');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Gracefully hide the card when the backend endpoint fails to load
  // (e.g. missing route in a test fixture, or a transient server error).
  // This keeps the rest of the /account page readable — the LLM proxy
  // feature is strictly additive and should not break the page on error.
  if (err) {
    return null;
  }

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
          <em>Not enabled.</em> Ask an admin to grant LLM proxy access for
          your account.
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
          {tokensUsed.toLocaleString()} /{' '}
          {tokenLimit.toLocaleString()} tokens used ·{' '}
          <strong>{remaining.toLocaleString()}</strong> remaining
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
          Your token isn&apos;t showing because it was granted before
          we stored the plaintext value. Ask an admin to revoke and
          re-grant your access.
        </p>
      )}
      <pre style={styles.snippet}>
{`# Claude Code
export ANTHROPIC_BASE_URL="${status.endpoint}"
export ANTHROPIC_API_KEY="${status.token ?? 'llmp_…'}"
# The League API key only grants access to Haiku. Claude Code defaults
# to Sonnet, so pin Haiku explicitly or you'll get "model not
# available" from Anthropic.
export ANTHROPIC_MODEL="claude-haiku-4-5-20251001"
export ANTHROPIC_SMALL_FAST_MODEL="claude-haiku-4-5-20251001"
claude

# curl (SDK appends /v1/messages to ANTHROPIC_BASE_URL)
curl -X POST "${status.endpoint}/v1/messages" \\
  -H "x-api-key: ${status.token ?? 'llmp_…'}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":64,
       "messages":[{"role":"user","content":"hi"}]}'`}
      </pre>
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
  subTitle: {
    fontSize: '0.95rem',
    fontWeight: 600,
    margin: '1rem 0 0.5rem 0',
    color: '#334155',
  },
  muted: {
    color: '#64748b',
    margin: '0.25rem 0',
  },
  errorText: {
    color: '#b91c1c',
    margin: 0,
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
    userSelect: 'all',
    wordBreak: 'break-all',
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
