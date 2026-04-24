/**
 * Dashboard — admin landing page (Sprint 010 T010).
 *
 * Three widgets stacked vertically:
 *  1. Pending Requests — up to 5 rows with Approve/Deny; "See all N" link.
 *  2. Cohorts — compact list with name; header links to /cohorts.
 *  3. User Counts — three stat cards: Students, Staff, Admins.
 *
 * Each widget manages its own loading and error state. One failing widget
 * does not affect the others.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../context/ToastContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminStats {
  totalStudents: number;
  totalStaff: number;
  totalAdmins: number;
  pendingRequests: number;
  openMergeSuggestions: number;
  cohortCount: number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchStats(): Promise<AdminStats> {
  const res = await fetch('/api/admin/stats');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Dashboard component
// ---------------------------------------------------------------------------

export default function Dashboard() {
  // SSE subscription lives in AdminLayout so it covers every admin page —
  // no need to mount a duplicate listener here.
  return (
    <div>
      <h2 style={pageHeadingStyle}>Dashboard</h2>
      <UserCountsWidget />
      <PendingActivityWidget />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PendingActivityWidget — pending account approvals. Each row has Approve
// and Deny plus two checkboxes so an admin can grant a League account
// and/or an LLM proxy token at the same moment they approve.
// ---------------------------------------------------------------------------

interface PendingUser {
  id: number;
  email: string;
  displayName: string | null;
  createdAt: string;
  cohort: { id: number; name: string } | null;
  logins: { provider: string; email: string | null; username: string | null }[];
}

interface ApprovePayload {
  provisionWorkspace?: boolean;
  grantLlmProxy?: boolean;
}

interface ApproveResult {
  ok: true;
  workspace?: { provisioned: boolean; error?: string };
  llmProxy?: { granted: boolean; error?: string };
}

async function fetchPendingUsers(): Promise<PendingUser[]> {
  const res = await fetch('/api/admin/pending-users');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function approvePendingUser(
  id: number,
  body: ApprovePayload,
): Promise<ApproveResult> {
  const res = await fetch(`/api/admin/users/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.json().catch(() => ({}));
    throw new Error((raw as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function denyPendingUser(id: number): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}/deny-approval`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

const DISPLAY_LIMIT = 10;

interface RowChoices {
  workspace: boolean;
  llmProxy: boolean;
}

function PendingActivityWidget() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<number, RowChoices>>({});

  const { data: users, isLoading, error } = useQuery<PendingUser[], Error>({
    queryKey: ['admin', 'dashboard', 'pending-users'],
    queryFn: fetchPendingUsers,
    refetchInterval: 60_000,
  });

  const approveMutation = useMutation<ApproveResult, Error, { id: number; body: ApprovePayload }>({
    mutationFn: ({ id, body }) => approvePendingUser(id, body),
    onSuccess: (result, { id }) => {
      const u = users?.find((x) => x.id === id);
      const who = u?.displayName ?? u?.email ?? `#${id}`;
      const bits: string[] = [];
      if (result.workspace) {
        bits.push(
          result.workspace.provisioned
            ? 'League account created'
            : `League account failed: ${result.workspace.error ?? 'unknown'}`,
        );
      }
      if (result.llmProxy) {
        bits.push(
          result.llmProxy.granted
            ? 'LLM proxy granted'
            : `LLM proxy failed: ${result.llmProxy.error ?? 'unknown'}`,
        );
      }
      const suffix = bits.length > 0 ? ` (${bits.join('; ')})` : '';
      const hasFailure =
        (result.workspace && !result.workspace.provisioned) ||
        (result.llmProxy && !result.llmProxy.granted);
      showToast(`Approved ${who}${suffix}`, hasFailure ? 'error' : 'success');
      setRowErrors((prev) => { const n = { ...prev }; delete n[`user-${id}`]; return n; });
      setChoices((prev) => { const n = { ...prev }; delete n[id]; return n; });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard', 'pending-users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err, { id }) => {
      setRowErrors((prev) => ({ ...prev, [`user-${id}`]: err.message }));
      showToast(`Approve failed: ${err.message}`, 'error');
    },
  });

  const denyMutation = useMutation<void, Error, number>({
    mutationFn: denyPendingUser,
    onSuccess: (_d, id) => {
      const u = users?.find((x) => x.id === id);
      showToast(`Denied account for ${u?.displayName ?? u?.email}`, 'info');
      setRowErrors((prev) => { const n = { ...prev }; delete n[`user-${id}`]; return n; });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard', 'pending-users'] });
    },
    onError: (err, id) => {
      setRowErrors((prev) => ({ ...prev, [`user-${id}`]: err.message }));
      showToast(`Deny failed: ${err.message}`, 'error');
    },
  });

  const total = users?.length ?? 0;
  const visible = (users ?? []).slice(0, DISPLAY_LIMIT);
  const anyPending = approveMutation.isPending || denyMutation.isPending;

  function getChoices(id: number): RowChoices {
    return choices[id] ?? { workspace: false, llmProxy: false };
  }
  function setChoice(id: number, key: keyof RowChoices, value: boolean) {
    setChoices((prev) => ({
      ...prev,
      [id]: { ...getChoices(id), [key]: value },
    }));
  }

  return (
    <section style={widgetStyle} aria-labelledby="pending-activity-heading">
      <h3 id="pending-activity-heading" style={widgetHeadingStyle}>
        Pending Accounts
      </h3>

      {isLoading && <p style={loadingStyle}>Loading pending accounts…</p>}

      {error && (
        <p style={errorStyle} role="alert">
          Failed to load pending accounts: {error?.message}
        </p>
      )}

      {!isLoading && !error && total === 0 && (
        <p style={emptyStyle}>No accounts awaiting approval.</p>
      )}

      {!isLoading && !error && total > 0 && (
        <>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Grant on approve</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const rowError = rowErrors[`user-${item.id}`];
                const c = getChoices(item.id);
                const hasCohort = item.cohort != null;
                const workspaceTooltip = hasCohort
                  ? 'Create a League workspace account on approve.'
                  : 'Assign a cohort on the user detail page before granting a League account.';
                return (
                  <tr key={`user-${item.id}`}>
                    <td style={tdStyle}>{item.displayName ?? '-'}</td>
                    <td style={tdStyle}>{item.email}</td>
                    <td style={tdStyle}>{new Date(item.createdAt).toLocaleDateString()}</td>
                    <td style={tdStyle}>
                      <div style={checkboxGroupStyle}>
                        <label style={checkboxLabelStyle} title={workspaceTooltip}>
                          <input
                            type="checkbox"
                            checked={c.workspace}
                            disabled={anyPending || !hasCohort}
                            onChange={(e) => setChoice(item.id, 'workspace', e.target.checked)}
                          />
                          League account
                        </label>
                        <label style={checkboxLabelStyle} title="Grant an LLM proxy token on approve.">
                          <input
                            type="checkbox"
                            checked={c.llmProxy}
                            disabled={anyPending}
                            onChange={(e) => setChoice(item.id, 'llmProxy', e.target.checked)}
                          />
                          LLM proxy
                        </label>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <div style={actionsCellStyle}>
                        <button
                          style={approveButtonStyle}
                          disabled={anyPending}
                          onClick={() =>
                            approveMutation.mutate({
                              id: item.id,
                              body: {
                                provisionWorkspace: c.workspace,
                                grantLlmProxy: c.llmProxy,
                              },
                            })
                          }
                          aria-label={`Approve account ${item.id}`}
                        >
                          Approve
                        </button>
                        <button
                          style={denyButtonStyle}
                          disabled={anyPending}
                          onClick={() => {
                            if (window.confirm(`Deny account for ${item.email}? They will be deactivated.`)) {
                              denyMutation.mutate(item.id);
                            }
                          }}
                          aria-label={`Deny account ${item.id}`}
                        >
                          Deny
                        </button>
                        {rowError && (
                          <span style={inlineErrorStyle} role="alert">
                            {rowError}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {total > DISPLAY_LIMIT && (
            <p style={seeAllStyle}>
              Showing {visible.length} of {total} pending accounts.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// UserCountsWidget
// ---------------------------------------------------------------------------

function UserCountsWidget() {
  const { data: stats, isLoading, error } = useQuery<AdminStats, Error>({
    queryKey: ['admin', 'dashboard', 'stats'],
    queryFn: fetchStats,
    refetchInterval: 60_000,
  });

  return (
    <section style={widgetStyle} aria-labelledby="user-counts-heading">
      <h3 id="user-counts-heading" style={widgetHeadingStyle}>
        User Counts
      </h3>

      {isLoading && <p style={loadingStyle}>Loading stats...</p>}

      {error && (
        <p style={errorStyle} role="alert">
          Failed to load stats: {error.message}
        </p>
      )}

      {!isLoading && !error && stats && (
        <div style={statCardsRowStyle}>
          <StatCard label="Students" value={stats.totalStudents} color="#2563eb" />
          <StatCard label="Staff" value={stats.totalStaff} color="#16a34a" />
          <StatCard label="Admins" value={stats.totalAdmins} color="#7c3aed" />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// StatCard helper
// ---------------------------------------------------------------------------

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={statCardStyle}>
      <span style={{ fontSize: 28, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageHeadingStyle: React.CSSProperties = {
  margin: '0 0 24px',
  fontSize: 20,
};

const widgetStyle: React.CSSProperties = {
  marginBottom: 28,
  padding: 20,
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  background: '#fafafa',
};

const widgetHeadingStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 16,
  fontWeight: 600,
};

const loadingStyle: React.CSSProperties = {
  color: '#64748b',
  fontSize: 14,
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
  fontSize: 14,
};

const emptyStyle: React.CSSProperties = {
  color: '#94a3b8',
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
  verticalAlign: 'middle',
};

const actionsCellStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
};

const approveButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: '#16a34a',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};

const denyButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: '#dc2626',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};

const inlineErrorStyle: React.CSSProperties = {
  color: '#dc2626',
  fontSize: 12,
};

const seeAllStyle: React.CSSProperties = {
  marginTop: 10,
  fontSize: 14,
};

const checkboxGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
};

const checkboxLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  userSelect: 'none',
};

const statCardsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 20,
  flexWrap: 'wrap',
};

const statCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '16px 24px',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  background: '#fff',
  minWidth: 100,
};

