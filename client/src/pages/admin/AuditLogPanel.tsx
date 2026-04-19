/**
 * AuditLogPanel — admin page for viewing and searching audit log events.
 *
 * Features:
 *  - Filter form: target user, actor, action type dropdown, date range
 *  - Paginated results table (page size: 50)
 *  - Clicking a row toggles inline detail expansion showing raw details JSON
 *  - Loading spinner while fetching
 *  - Error banner if fetch fails
 *  - Empty state when no records match
 *
 * Route: /admin/audit-log (wired in T011).
 */

import { useState, useEffect, useCallback, Fragment } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

const KNOWN_ACTIONS = [
  'provision_workspace',
  'provision_claude',
  'suspend_workspace',
  'suspend_claude',
  'remove_workspace',
  'remove_claude',
  'add_login',
  'remove_login',
  'create_cohort',
  'merge_approve',
  'merge_reject',
  'pike13_writeback_github',
  'pike13_writeback_email',
  'delete_user',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditEvent {
  id: number;
  createdAt: string;
  actorId: number | null;
  actorName: string | null;
  action: string;
  targetUserId: number | null;
  targetUserName: string | null;
  targetEntityType: string | null;
  targetEntityId: string | null;
  details: unknown;
}

interface AuditLogResult {
  total: number;
  page: number;
  pageSize: number;
  items: AuditEvent[];
}

interface AuditFilters {
  targetUser: string;
  actor: string;
  action: string;
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

let spinnerStyleInjected = false;

function Spinner() {
  if (!spinnerStyleInjected && typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = '@keyframes alp-rotate { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
    spinnerStyleInjected = true;
  }
  return (
    <span
      role="status"
      aria-label="Loading"
      style={spinnerStyle}
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '\u2026';
}

function buildQueryString(filters: AuditFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.actor.trim()) params.set('actorId', filters.actor.trim());
  if (filters.targetUser.trim()) params.set('targetUserId', filters.targetUser.trim());
  if (filters.action) params.set('action', filters.action);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  return params.toString();
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function actorLabel(event: AuditEvent): string {
  if (event.actorName && event.actorId !== null) {
    return `${event.actorName} (#${event.actorId})`;
  }
  if (event.actorId !== null) return `#${event.actorId}`;
  return '—';
}

function targetLabel(event: AuditEvent): string {
  if (event.targetUserName && event.targetUserId !== null) {
    return `${event.targetUserName} (#${event.targetUserId})`;
  }
  if (event.targetUserId !== null) return `#${event.targetUserId}`;
  if (event.targetEntityType) {
    return event.targetEntityId
      ? `${event.targetEntityType} #${event.targetEntityId}`
      : event.targetEntityType;
  }
  return '—';
}

function detailsSummary(details: unknown): string {
  try {
    return truncate(JSON.stringify(details), 80);
  } catch {
    return '—';
  }
}

// ---------------------------------------------------------------------------
// AuditLogPanel
// ---------------------------------------------------------------------------

export default function AuditLogPanel() {
  const [filters, setFilters] = useState<AuditFilters>({
    targetUser: '',
    actor: '',
    action: '',
    from: '',
    to: '',
  });

  // Draft filters — updated on each keystroke, applied on submit
  const [draft, setDraft] = useState<AuditFilters>({
    targetUser: '',
    actor: '',
    action: '',
    from: '',
    to: '',
  });

  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AuditLogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchAuditLog = useCallback(
    async (activeFilters: AuditFilters, activePage: number) => {
      setLoading(true);
      setError(null);
      try {
        const qs = buildQueryString(activeFilters, activePage);
        const res = await fetch(`/api/admin/audit-log?${qs}`, { credentials: 'include' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const data: AuditLogResult = await res.json();
        setResult(data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to load audit log';
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Initial load
  useEffect(() => {
    fetchAuditLog(filters, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFilters(draft);
    setPage(1);
    setExpandedId(null);
    fetchAuditLog(draft, 1);
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
    setExpandedId(null);
    fetchAuditLog(filters, newPage);
  }

  function toggleRow(id: number) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  const totalPages = result ? Math.ceil(result.total / PAGE_SIZE) : 1;

  return (
    <div>
      <h2 style={headingStyle}>Audit Log</h2>

      {/* Filter form */}
      <form onSubmit={handleSubmit} style={formStyle}>
        <div style={formRowStyle}>
          <label style={labelStyle}>
            Target User ID
            <input
              type="text"
              value={draft.targetUser}
              onChange={(e) => setDraft((d) => ({ ...d, targetUser: e.target.value }))}
              placeholder="e.g. 42"
              style={inputStyle}
              aria-label="Target user ID filter"
            />
          </label>

          <label style={labelStyle}>
            Actor ID
            <input
              type="text"
              value={draft.actor}
              onChange={(e) => setDraft((d) => ({ ...d, actor: e.target.value }))}
              placeholder="e.g. 7"
              style={inputStyle}
              aria-label="Actor ID filter"
            />
          </label>

          <label style={labelStyle}>
            Action
            <select
              value={draft.action}
              onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
              style={selectStyle}
              aria-label="Action filter"
            >
              <option value="">All</option>
              {KNOWN_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            From
            <input
              type="date"
              value={draft.from}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
              style={inputStyle}
              aria-label="Start date filter"
            />
          </label>

          <label style={labelStyle}>
            To
            <input
              type="date"
              value={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              style={inputStyle}
              aria-label="End date filter"
            />
          </label>

          <button type="submit" style={submitButtonStyle} disabled={loading}>
            {loading ? <><Spinner /> Searching...</> : 'Search'}
          </button>
        </div>
      </form>

      {/* Error banner */}
      {error && (
        <div style={errorBannerStyle} role="alert">
          Failed to load audit log: {error}
        </div>
      )}

      {/* Loading indicator (when no results yet) */}
      {loading && !result && (
        <p style={loadingStyle}>
          <Spinner /> Loading audit log...
        </p>
      )}

      {/* Results */}
      {result && (
        <>
          {result.total === 0 ? (
            <p style={emptyStyle}>No audit records match the current filters.</p>
          ) : (
            <>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Timestamp</th>
                    <th style={thStyle}>Actor</th>
                    <th style={thStyle}>Action</th>
                    <th style={thStyle}>Target User</th>
                    <th style={thStyle}>Details Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((event) => {
                    const isExpanded = expandedId === event.id;
                    return (
                      <Fragment key={event.id}>
                        <tr
                          onClick={() => toggleRow(event.id)}
                          style={rowStyle(isExpanded)}
                          aria-expanded={isExpanded}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') toggleRow(event.id);
                          }}
                        >
                          <td style={tdStyle}>{formatTimestamp(event.createdAt)}</td>
                          <td style={tdStyle}>{actorLabel(event)}</td>
                          <td style={tdStyle}>
                            <span style={actionBadgeStyle}>{event.action}</span>
                          </td>
                          <td style={tdStyle}>{targetLabel(event)}</td>
                          <td style={{ ...tdStyle, ...summaryCellStyle }}>
                            {detailsSummary(event.details)}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} style={detailCellStyle}>
                              <pre style={detailPreStyle}>
                                {JSON.stringify(event.details, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              <div style={paginationStyle}>
                <button
                  style={pageButtonStyle(page <= 1 || loading)}
                  disabled={page <= 1 || loading}
                  onClick={() => handlePageChange(page - 1)}
                  aria-label="Previous page"
                >
                  Previous
                </button>
                <span style={pageInfoStyle}>
                  Page {page} of {totalPages} &mdash; {result.total} total
                </span>
                <button
                  style={pageButtonStyle(page >= totalPages || loading)}
                  disabled={page >= totalPages || loading}
                  onClick={() => handlePageChange(page + 1)}
                  aria-label="Next page"
                >
                  Next
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const headingStyle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: 20,
};

const formStyle: React.CSSProperties = {
  marginBottom: 20,
  padding: '14px 16px',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
};

const formRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'flex-end',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  fontWeight: 600,
  color: '#64748b',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  minWidth: 120,
};

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  minWidth: 160,
  background: '#fff',
};

const submitButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 18px',
  fontSize: 13,
  fontWeight: 600,
  background: '#4f46e5',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  alignSelf: 'flex-end',
};

const errorBannerStyle: React.CSSProperties = {
  marginBottom: 16,
  padding: '10px 14px',
  background: '#fef2f2',
  border: '1px solid #fca5a5',
  borderRadius: 4,
  color: '#dc2626',
  fontSize: 13,
};

const loadingStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: '#64748b',
  fontSize: 13,
};

const emptyStyle: React.CSSProperties = {
  color: '#94a3b8',
  textAlign: 'center',
  marginTop: 24,
  fontSize: 14,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid #e2e8f0',
  fontWeight: 600,
  fontSize: 13,
  color: '#64748b',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'top',
};

const summaryCellStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  color: '#475569',
  maxWidth: 300,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
};

function rowStyle(expanded: boolean): React.CSSProperties {
  return {
    cursor: 'pointer',
    background: expanded ? '#f0f0ff' : undefined,
    transition: 'background 0.1s',
  };
}

const actionBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  background: '#e0f2fe',
  color: '#0369a1',
  fontFamily: 'monospace',
};

const detailCellStyle: React.CSSProperties = {
  padding: '0 12px 12px',
  background: '#f8fafc',
  borderBottom: '1px solid #e2e8f0',
};

const detailPreStyle: React.CSSProperties = {
  margin: 0,
  padding: '12px',
  background: '#1e293b',
  color: '#e2e8f0',
  borderRadius: 6,
  fontSize: 12,
  overflowX: 'auto',
  maxHeight: 400,
  overflowY: 'auto',
};

const paginationStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  marginTop: 16,
  padding: '12px 0',
};

const pageInfoStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#475569',
};

function pageButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 500,
    background: disabled ? '#f1f5f9' : '#fff',
    color: disabled ? '#94a3b8' : '#334155',
    border: '1px solid #cbd5e1',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

const spinnerStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 12,
  height: 12,
  border: '2px solid rgba(79,70,229,0.3)',
  borderTopColor: '#4f46e5',
  borderRadius: '50%',
  animation: 'alp-rotate 0.7s linear infinite',
};
