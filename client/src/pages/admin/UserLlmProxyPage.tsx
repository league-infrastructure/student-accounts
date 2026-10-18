/**
 * UserLlmProxyPage — /admin/users/:id/llm-proxy (sprint 003, ticket 005).
 *
 * The admin's full view of one student's LLM proxy, so an instructor can
 * walk the student through setup from their own screen:
 *
 *   1. Header with the student's name, the same figures and key controls
 *      as the detail-panel card (AdminLlmProxyFigures) plus the endpoint.
 *   2. The shared LlmProxySetupExamples rendered with THIS student's key
 *      and endpoint — identical to what the student sees on /llm-proxy.
 *   3. "Recent requests": the last 50 rows of our own request log
 *      (GET /api/admin/users/:id/llm-proxy/requests), newest first.
 *
 * Grant / revoke stay on the detail panel; this page links back to it.
 */

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import LlmProxySetupExamples from '../../components/LlmProxySetupExamples';
import { prettifyName } from './utils/prettifyName';
import AdminLlmProxyFigures, { STATUS_LABEL, statusKind, useAdminLlmProxyStatus } from './AdminLlmProxyFigures';
import { OpenRouterLink } from './UserLlmProxyCard';

export const RECENT_REQUESTS_LIMIT = 50;

/** One row of GET /api/admin/users/:id/llm-proxy/requests. */
export interface LlmProxyRequestRow {
  id: number;
  ts: string;
  protocol: string;
  modelRequested: string | null;
  modelSent: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  status: number;
}

interface UserSummary {
  id: number;
  email: string;
  displayName: string | null;
}

async function fetchUserSummary(id: number): Promise<UserSummary> {
  const res = await fetch(`/api/admin/users/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<UserSummary>;
}

export async function fetchRecentRequests(
  userId: number,
  limit = RECENT_REQUESTS_LIMIT,
): Promise<LlmProxyRequestRow[]> {
  const res = await fetch(`/api/admin/users/${userId}/llm-proxy/requests?limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<LlmProxyRequestRow[]>;
}

/** Per-request costs are fractions of a cent; show four decimals. */
export function formatRequestCost(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}

export default function UserLlmProxyPage() {
  const { id } = useParams<{ id: string }>();
  const userId = id ? parseInt(id, 10) : NaN;

  // Same key as UserDetailPanel's user query, so the name is usually cached.
  const userQuery = useQuery<UserSummary>({
    queryKey: ['admin', 'users', userId, 'detail'],
    queryFn: () => fetchUserSummary(userId),
    enabled: Number.isFinite(userId),
  });
  const statusQuery = useAdminLlmProxyStatus(userId);
  const requestsQuery = useQuery<LlmProxyRequestRow[]>({
    queryKey: ['admin', 'users', userId, 'llm-proxy', 'requests', RECENT_REQUESTS_LIMIT],
    queryFn: () => fetchRecentRequests(userId),
    enabled: Number.isFinite(userId),
  });

  const user = userQuery.data;
  const name = user ? prettifyName({ email: user.email, displayName: user.displayName }) : '';
  const status = statusQuery.data;

  if (!Number.isFinite(userId)) {
    return (
      <div style={styles.container}>
        <h1 style={styles.pageTitle}>LLM Proxy</h1>
        <div role="alert" style={styles.error}>Invalid user id.</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.breadcrumb}>
        <Link to={`/users/${userId}`} style={styles.backLink} data-testid="llm-proxy-back-link">
          ← {name || 'User'}
        </Link>
      </div>
      <h1 style={styles.pageTitle} data-testid="llm-proxy-page-title">
        LLM Proxy{name ? ` — ${name}` : ''}
      </h1>

      {(userQuery.error || statusQuery.error) && (
        <div role="alert" style={styles.error}>
          {((userQuery.error ?? statusQuery.error) as Error).message}
        </div>
      )}

      {/* 1. Figures + key */}
      <section style={styles.card} data-testid="admin-llm-proxy-status">
        {!status ? (
          <p style={styles.muted}>Loading…</p>
        ) : status.enabled ? (
          <>
            <AdminLlmProxyFigures userId={userId} status={status} showEndpoint />
            <div style={styles.actions}>
              <OpenRouterLink />
            </div>
          </>
        ) : (
          <div data-testid="llm-proxy-not-enabled">
            <p style={{ margin: '0 0 6px' }}>
              <strong>{STATUS_LABEL[statusKind(status)]}</strong> — {name || 'this user'} has no
              active LLM proxy key.
            </p>
            <p style={styles.muted}>
              Grant one from the{' '}
              <Link to={`/users/${userId}`} style={styles.inlineLink}>
                user's page
              </Link>
              .
            </p>
            <div style={styles.actions}>
              <OpenRouterLink />
            </div>
          </div>
        )}
      </section>

      {/* 2. Setup examples with this student's key */}
      {status?.enabled && status.token && status.endpoint && (
        <section style={{ ...styles.card, marginTop: '1rem' }} data-testid="admin-llm-proxy-examples">
          <h2 style={styles.sectionTitle}>Set up {name ? `${name}'s` : 'the student’s'} tool</h2>
          <p style={styles.muted}>
            Exactly what the student sees on their own LLM Proxy page — each example already has
            their key and the endpoint. Model tiers:{' '}
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
      )}

      {/* 3. Recent requests */}
      <section style={{ ...styles.card, marginTop: '1rem' }} data-testid="admin-llm-proxy-requests">
        <h2 style={styles.sectionTitle}>Recent requests</h2>
        <RecentRequests
          rows={requestsQuery.data}
          error={requestsQuery.error ? (requestsQuery.error as Error).message : null}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent requests table
// ---------------------------------------------------------------------------

function RecentRequests({ rows, error }: { rows?: LlmProxyRequestRow[]; error: string | null }) {
  if (error) {
    return (
      <div role="alert" style={styles.error}>
        Could not load requests: {error}
      </div>
    );
  }
  if (!rows) return <p style={styles.muted}>Loading…</p>;
  if (rows.length === 0) {
    return (
      <p style={styles.muted} data-testid="llm-proxy-requests-empty">
        No requests yet. Rows appear here as soon as the student's tool makes its first call
        through the proxy.
      </p>
    );
  }
  return (
    <>
      <p style={styles.muted}>
        Last {rows.length} request{rows.length === 1 ? '' : 's'}, newest first.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table} data-testid="llm-proxy-requests-table">
          <thead>
            <tr>
              <th style={styles.th}>Time</th>
              <th style={styles.th}>Protocol</th>
              <th style={styles.th}>Model sent</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Tokens in</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Tokens out</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Cost</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid="llm-proxy-request-row">
                <td style={styles.td}>{new Date(r.ts).toLocaleString()}</td>
                <td style={styles.td}>{r.protocol}</td>
                <td style={styles.td}>
                  <code style={styles.code}>{r.modelSent ?? '—'}</code>
                  {r.modelRequested && r.modelRequested !== r.modelSent && (
                    <span style={styles.muted}> (asked for {r.modelRequested})</span>
                  )}
                </td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{r.inputTokens.toLocaleString()}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{r.outputTokens.toLocaleString()}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{formatRequestCost(r.costUsd)}</td>
                <td
                  style={{
                    ...styles.td,
                    textAlign: 'right',
                    color: r.status >= 400 ? '#991b1b' : '#0f172a',
                  }}
                >
                  {r.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 900, margin: '32px auto', padding: '0 1rem' },
  breadcrumb: { fontSize: 13, marginBottom: 6 },
  backLink: { color: '#2563eb', textDecoration: 'none', fontWeight: 600 },
  inlineLink: { color: '#2563eb' },
  pageTitle: { fontSize: '1.5rem', fontWeight: 700, color: '#1e293b', margin: '0 0 1rem' },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '1.25rem 1.5rem',
    background: '#fff',
  },
  sectionTitle: { fontSize: '1rem', fontWeight: 600, color: '#1e293b', margin: '0 0 0.5rem' },
  muted: { color: '#64748b', margin: '0.25rem 0', fontSize: '0.85rem' },
  error: {
    fontSize: 13,
    color: '#991b1b',
    background: '#fee2e2',
    border: '1px solid #fecaca',
    padding: '8px 10px',
    borderRadius: 6,
    marginBottom: 10,
  },
  actions: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left',
    padding: '6px 8px',
    borderBottom: '1px solid #e2e8f0',
    color: '#64748b',
    fontWeight: 600,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  td: { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    padding: '1px 5px',
    background: '#f1f5f9',
    borderRadius: 4,
  },
};
