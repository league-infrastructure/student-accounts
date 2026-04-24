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

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { prettifyName } from './utils/prettifyName';
import { useToast } from '../../context/ToastContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProvisioningRequest {
  id: number;
  userId: number;
  userName: string | null;
  userEmail: string;
  userCohort: { id: number; name: string } | null;
  requestedType: 'workspace' | 'claude' | 'workspace_and_claude';
  createdAt: string;
}

interface ApprovePayload {
  id: number;
  cohortId?: number;
}

interface Cohort {
  id: number;
  name: string;
  google_ou_path: string | null;
  createdAt: string;
}

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

async function fetchPendingRequests(): Promise<ProvisioningRequest[]> {
  const res = await fetch('/api/admin/provisioning-requests?status=pending');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function approveRequest({ id, cohortId }: ApprovePayload): Promise<void> {
  const res = await fetch(`/api/admin/provisioning-requests/${id}/approve`, {
    method: 'POST',
    headers: cohortId != null ? { 'Content-Type': 'application/json' } : undefined,
    body: cohortId != null ? JSON.stringify({ cohortId }) : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

async function denyRequest({
  id,
  permanent,
}: {
  id: number;
  permanent?: boolean;
}): Promise<void> {
  const res = await fetch(`/api/admin/provisioning-requests/${id}/reject`, {
    method: 'POST',
    headers: permanent ? { 'Content-Type': 'application/json' } : undefined,
    body: permanent ? JSON.stringify({ permanent: true }) : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

async function fetchCohorts(): Promise<Cohort[]> {
  const res = await fetch('/api/admin/cohorts');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

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
  useAdminEventStream();
  return (
    <div>
      <h2 style={pageHeadingStyle}>Dashboard</h2>
      <UserCountsWidget />
      <PendingActivityWidget />
    </div>
  );
}

/**
 * Opens a single EventSource to /api/admin/events for the lifetime of the
 * Dashboard page. Server pushes `pending-users` / `pending-requests`
 * events as the change bus fires; we invalidate the matching react-query
 * key so the widget refetches on demand instead of polling on a timer.
 *
 * If the stream fails to open (network blip, stale session) we fall back
 * to a 30s background refetch via the query itself — see below.
 */
function useAdminEventStream() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // jsdom doesn't implement EventSource — real browsers do. When
    // unavailable we silently fall back to the background refetchInterval
    // on each widget.
    if (typeof EventSource === 'undefined') return;

    const source = new EventSource('/api/admin/events');

    const invalidate = (keyTail: string) => () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard', keyTail] });
    };

    source.addEventListener('pending-users', invalidate('pending-users'));
    source.addEventListener('pending-requests', invalidate('pending-requests'));
    // stats is cheap to refresh when anything changes — counts move with
    // both flows.
    source.addEventListener('pending-users', invalidate('stats'));
    source.addEventListener('pending-requests', invalidate('stats'));

    return () => {
      source.close();
    };
  }, [queryClient]);
}

// ---------------------------------------------------------------------------
// PendingActivityWidget — unified view of pending accounts and requests
// ---------------------------------------------------------------------------

interface PendingUser {
  id: number;
  email: string;
  displayName: string | null;
  createdAt: string;
  logins: { provider: string; email: string | null; username: string | null }[];
}

type ActivityItem =
  | { type: 'account'; id: number; email: string; displayName: string | null; createdAt: string; logins: { provider: string }[] }
  | { type: 'request'; id: number; email: string; displayName: string | null; createdAt: string; requestedType: 'workspace' | 'claude' | 'workspace_and_claude' | 'llm_proxy'; userCohort: { id: number; name: string } | null };

async function fetchPendingUsers(): Promise<PendingUser[]> {
  const res = await fetch('/api/admin/pending-users');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function approvePendingUser(id: number): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}/approve`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

async function denyPendingUser(id: number): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}/deny-approval`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// PendingActivityWidget — unified view of pending accounts and requests
// ---------------------------------------------------------------------------

const DISPLAY_LIMIT = 10;

function PendingActivityWidget() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [cohortPickerFor, setCohortPickerFor] = useState<Record<number, number>>({});

  const { data: users, isLoading: usersLoading, error: usersError } = useQuery<PendingUser[], Error>({
    queryKey: ['admin', 'dashboard', 'pending-users'],
    queryFn: fetchPendingUsers,
    refetchInterval: 60_000,
  });

  const { data: requests, isLoading: requestsLoading, error: requestsError } = useQuery<ProvisioningRequest[], Error>({
    queryKey: ['admin', 'dashboard', 'pending-requests'],
    queryFn: fetchPendingRequests,
    refetchInterval: 60_000,
  });

  const { data: cohorts } = useQuery<Cohort[], Error>({
    queryKey: ['admin', 'dashboard', 'cohorts'],
    queryFn: fetchCohorts,
  });

  const approveUserMutation = useMutation<void, Error, number>({
    mutationFn: approvePendingUser,
    onSuccess: (_d, id) => {
      const u = users?.find((x) => x.id === id);
      showToast(`Approved account for ${u?.displayName ?? u?.email}`, 'success');
      setRowErrors((prev) => { const n = { ...prev }; delete n[`user-${id}`]; return n; });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard', 'pending-users'] });
    },
    onError: (err, id) => {
      setRowErrors((prev) => ({ ...prev, [`user-${id}`]: err.message }));
      showToast(`Approve failed: ${err.message}`, 'error');
    },
  });

  const denyUserMutation = useMutation<void, Error, number>({
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

  const approveReqMutation = useMutation<void, Error, ApprovePayload>({
    mutationFn: approveRequest,
    onSuccess: (_data, { id }) => {
      const req = requests?.find((r) => r.id === id);
      const who = req ? prettifyName({ email: req.userEmail, displayName: req.userName }) : `#${id}`;
      showToast(`Approved ${req?.requestedType ?? 'request'} for ${who}`, 'success');
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[`req-${id}`];
        return next;
      });
      setCohortPickerFor((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard', 'pending-requests'] });
    },
    onError: (err, { id }) => {
      setRowErrors((prev) => ({ ...prev, [`req-${id}`]: err.message }));
      showToast(`Approve failed: ${err.message}`, 'error');
    },
  });

  const denyReqMutation = useMutation<void, Error, { id: number; permanent?: boolean }>({
    mutationFn: denyRequest,
    onSuccess: (_data, { id, permanent }) => {
      const req = requests?.find((r) => r.id === id);
      const who = req ? prettifyName({ email: req.userEmail, displayName: req.userName }) : `#${id}`;
      showToast(
        permanent ? `Permanently denied request for ${who}` : `Denied request for ${who}`,
        'info',
      );
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[`req-${id}`];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard', 'pending-requests'] });
    },
    onError: (err, { id }) => {
      setRowErrors((prev) => ({ ...prev, [`req-${id}`]: err.message }));
      showToast(`Deny failed: ${err.message}`, 'error');
    },
  });

  const isLoading = usersLoading || requestsLoading;
  const error = usersError || requestsError;

  const userItems: ActivityItem[] = (users ?? []).map(u => ({
    type: 'account',
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    createdAt: u.createdAt,
    logins: u.logins,
  }));

  const reqItems: ActivityItem[] = (requests ?? []).map(r => ({
    type: 'request',
    id: r.id,
    email: r.userEmail,
    displayName: r.userName,
    createdAt: r.createdAt,
    requestedType: r.requestedType,
    userCohort: r.userCohort,
  }));

  const allItems = [...userItems, ...reqItems].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const total = allItems.length;
  const visible = allItems.slice(0, DISPLAY_LIMIT);
  const anyPending = approveUserMutation.isPending || denyUserMutation.isPending ||
                     approveReqMutation.isPending || denyReqMutation.isPending;

  return (
    <section style={widgetStyle} aria-labelledby="pending-activity-heading">
      <h3 id="pending-activity-heading" style={widgetHeadingStyle}>
        Pending Activity
      </h3>

      {isLoading && <p style={loadingStyle}>Loading pending activity...</p>}

      {error && (
        <p style={errorStyle} role="alert">
          Failed to load pending activity: {error?.message}
        </p>
      )}

      {!isLoading && !error && total === 0 && (
        <p style={emptyStyle}>No pending activity.</p>
      )}

      {!isLoading && !error && total > 0 && (
        <>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                if (item.type === 'account') {
                  const rowError = rowErrors[`user-${item.id}`];
                  return (
                    <tr key={`user-${item.id}`}>
                      <td style={tdStyle}>{item.displayName ?? '-'}</td>
                      <td style={tdStyle}>{item.email}</td>
                      <td style={tdStyle}>
                        <span style={activityTypeBadgeStyle('account')}>Account</span>
                      </td>
                      <td style={tdStyle}>{new Date(item.createdAt).toLocaleDateString()}</td>
                      <td style={tdStyle}>
                        <div style={actionsCellStyle}>
                          <button
                            style={approveButtonStyle}
                            disabled={anyPending}
                            onClick={() => approveUserMutation.mutate(item.id)}
                            aria-label={`Approve account ${item.id}`}
                          >
                            Approve
                          </button>
                          <button
                            style={denyButtonStyle}
                            disabled={anyPending}
                            onClick={() => {
                              if (window.confirm(`Deny account for ${item.email}? They will be deactivated.`)) {
                                denyUserMutation.mutate(item.id);
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
                } else {
                  const rowError = rowErrors[`req-${item.id}`];
                  const needsCohort = item.requestedType === 'workspace' && item.userCohort == null;
                  const pickedCohortId = cohortPickerFor[item.id] ?? 0;

                  return (
                    <tr key={`req-${item.id}`}>
                      <td style={tdStyle}>{item.displayName ?? '-'}</td>
                      <td style={tdStyle}>{item.email}</td>
                      <td style={tdStyle}>
                        <span style={typeBadgeStyle(item.requestedType)}>
                          {item.requestedType}
                        </span>
                      </td>
                      <td style={tdStyle}>{new Date(item.createdAt).toLocaleDateString()}</td>
                      <td style={tdStyle}>
                        <div style={actionsCellStyle}>
                          {needsCohort ? (
                            <>
                              <select
                                style={selectStyle}
                                value={pickedCohortId || ''}
                                disabled={anyPending}
                                onChange={(e) =>
                                  setCohortPickerFor((prev) => ({
                                    ...prev,
                                    [item.id]: parseInt(e.target.value, 10) || 0,
                                  }))
                                }
                                aria-label={`Select cohort for request ${item.id}`}
                              >
                                <option value="">Select a cohort…</option>
                                {(cohorts ?? []).map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                    {c.google_ou_path ? '' : ' (no OU)'}
                                  </option>
                                ))}
                              </select>
                              <button
                                style={approveButtonStyle}
                                disabled={anyPending || !pickedCohortId}
                                onClick={() =>
                                  approveReqMutation.mutate({
                                    id: item.id,
                                    cohortId: pickedCohortId,
                                  })
                                }
                                aria-label={`Approve request ${item.id}`}
                              >
                                Approve
                              </button>
                              <button
                                style={denyButtonStyle}
                                disabled={anyPending}
                                onClick={() => denyReqMutation.mutate({ id: item.id })}
                                aria-label={`Deny request ${item.id}`}
                              >
                                Deny
                              </button>
                              <button
                                style={permaDenyButtonStyle}
                                disabled={anyPending}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Permanently deny this ${item.requestedType} request? The user will not be able to request again.`,
                                    )
                                  ) {
                                    denyReqMutation.mutate({ id: item.id, permanent: true });
                                  }
                                }}
                                aria-label={`Permanently deny request ${item.id}`}
                              >
                                Deny permanently
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                style={approveButtonStyle}
                                disabled={anyPending}
                                onClick={() => approveReqMutation.mutate({ id: item.id })}
                                aria-label={`Approve request ${item.id}`}
                              >
                                Approve
                              </button>
                              <button
                                style={denyButtonStyle}
                                disabled={anyPending}
                                onClick={() => denyReqMutation.mutate({ id: item.id })}
                                aria-label={`Deny request ${item.id}`}
                              >
                                Deny
                              </button>
                              <button
                                style={permaDenyButtonStyle}
                                disabled={anyPending}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Permanently deny this ${item.requestedType} request? The user will not be able to request again.`,
                                    )
                                  ) {
                                    denyReqMutation.mutate({ id: item.id, permanent: true });
                                  }
                                }}
                                aria-label={`Permanently deny request ${item.id}`}
                              >
                                Deny permanently
                              </button>
                            </>
                          )}
                          {rowError && (
                            <span style={inlineErrorStyle} role="alert">
                              {rowError}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }
              })}
            </tbody>
          </table>

          {total > DISPLAY_LIMIT && (
            <p style={seeAllStyle}>
              Showing {visible.length} of {total} items. Visit <Link to="/requests" style={linkStyle}>Pending Requests</Link> to see all.
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

const widgetHeaderRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
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

const permaDenyButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: '#7f1d1d',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 12,
  borderRadius: 4,
  border: '1px solid #cbd5e1',
  background: '#fff',
};

const inlineErrorStyle: React.CSSProperties = {
  color: '#dc2626',
  fontSize: 12,
};

const seeAllStyle: React.CSSProperties = {
  marginTop: 10,
  fontSize: 14,
};

const linkStyle: React.CSSProperties = {
  color: '#4f46e5',
  textDecoration: 'none',
};

const manageLinkStyle: React.CSSProperties = {
  color: '#4f46e5',
  textDecoration: 'none',
  fontSize: 14,
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

function typeBadgeStyle(type: string): React.CSSProperties {
  const colorMap: Record<string, string> = {
    workspace: '#2563eb',
    claude: '#7c3aed',
    workspace_and_claude: '#d97706',
    llm_proxy: '#ec4899',
  };
  return {
    display: 'inline-block',
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 10,
    background: colorMap[type] ?? '#64748b',
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  };
}

function activityTypeBadgeStyle(type: 'account' | 'request'): React.CSSProperties {
  const colorMap: Record<string, string> = {
    account: '#6366f1',
    request: '#f59e0b',
  };
  return {
    display: 'inline-block',
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 10,
    background: colorMap[type],
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  };
}
