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
  return (
    <div>
      <h2 style={pageHeadingStyle}>Dashboard</h2>
      <PendingRequestsWidget />
      <CohortsWidget />
      <UserCountsWidget />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PendingRequestsWidget
// ---------------------------------------------------------------------------

const DISPLAY_LIMIT = 5;

function PendingRequestsWidget() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [cohortPickerFor, setCohortPickerFor] = useState<Record<number, number>>({});

  const { data: requests, isLoading, error } = useQuery<ProvisioningRequest[], Error>({
    queryKey: ['admin', 'dashboard', 'pending-requests'],
    queryFn: fetchPendingRequests,
  });

  const { data: cohorts } = useQuery<Cohort[], Error>({
    queryKey: ['admin', 'dashboard', 'cohorts'],
    queryFn: fetchCohorts,
  });

  const approveMutation = useMutation<void, Error, ApprovePayload>({
    mutationFn: approveRequest,
    onSuccess: (_data, { id }) => {
      const req = requests?.find((r) => r.id === id);
      const who = req ? prettifyName({ email: req.userEmail, displayName: req.userName }) : `#${id}`;
      const what = req?.requestedType ?? 'request';
      showToast(`Approved ${what} for ${who}`, 'success');
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[id];
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
      setRowErrors((prev) => ({ ...prev, [id]: err.message }));
      showToast(`Approve failed: ${err.message}`, 'error');
    },
  });

  const denyMutation = useMutation<void, Error, { id: number; permanent?: boolean }>({
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
        delete next[id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard', 'pending-requests'] });
    },
    onError: (err, { id }) => {
      setRowErrors((prev) => ({ ...prev, [id]: err.message }));
      showToast(`Deny failed: ${err.message}`, 'error');
    },
  });

  const total = requests?.length ?? 0;
  const visible = requests?.slice(0, DISPLAY_LIMIT) ?? [];
  const anyPending = approveMutation.isPending || denyMutation.isPending;

  return (
    <section style={widgetStyle} aria-labelledby="pending-requests-heading">
      <h3 id="pending-requests-heading" style={widgetHeadingStyle}>
        Pending Requests
      </h3>

      {isLoading && <p style={loadingStyle}>Loading pending requests...</p>}

      {error && (
        <p style={errorStyle} role="alert">
          Failed to load pending requests: {error.message}
        </p>
      )}

      {!isLoading && !error && total === 0 && (
        <p style={emptyStyle}>No pending requests.</p>
      )}

      {!isLoading && !error && total > 0 && (
        <>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Submitted</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((req) => {
                const displayName = prettifyName({
                  email: req.userEmail,
                  displayName: req.userName,
                });
                const rowError = rowErrors[req.id];
                const needsCohort =
                  req.requestedType === 'workspace' && req.userCohort == null;
                const pickedCohortId = cohortPickerFor[req.id] ?? 0;

                return (
                  <tr key={req.id}>
                    <td style={tdStyle}>{displayName}</td>
                    <td style={tdStyle}>{req.userEmail}</td>
                    <td style={tdStyle}>
                      <span style={typeBadgeStyle(req.requestedType)}>
                        {req.requestedType}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {new Date(req.createdAt).toLocaleDateString()}
                    </td>
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
                                  [req.id]: parseInt(e.target.value, 10) || 0,
                                }))
                              }
                              aria-label={`Select cohort for request ${req.id}`}
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
                                approveMutation.mutate({
                                  id: req.id,
                                  cohortId: pickedCohortId,
                                })
                              }
                              aria-label={`Approve request ${req.id} with selected cohort`}
                            >
                              Approve
                            </button>
                            <button
                              style={denyButtonStyle}
                              disabled={anyPending}
                              onClick={() => denyMutation.mutate({ id: req.id })}
                              aria-label={`Deny request ${req.id}`}
                            >
                              Deny
                            </button>
                            <button
                              style={permaDenyButtonStyle}
                              disabled={anyPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Permanently deny this ${req.requestedType} request? The user will not be able to request again.`,
                                  )
                                ) {
                                  denyMutation.mutate({ id: req.id, permanent: true });
                                }
                              }}
                              aria-label={`Permanently deny request ${req.id}`}
                            >
                              Deny permanently
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              style={approveButtonStyle}
                              disabled={anyPending}
                              onClick={() => approveMutation.mutate({ id: req.id })}
                              aria-label={`Approve request ${req.id}`}
                            >
                              Approve
                            </button>
                            <button
                              style={denyButtonStyle}
                              disabled={anyPending}
                              onClick={() => denyMutation.mutate({ id: req.id })}
                              aria-label={`Deny request ${req.id}`}
                            >
                              Deny
                            </button>
                            <button
                              style={permaDenyButtonStyle}
                              disabled={anyPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Permanently deny this ${req.requestedType} request? The user will not be able to request again.`,
                                  )
                                ) {
                                  denyMutation.mutate({ id: req.id, permanent: true });
                                }
                              }}
                              aria-label={`Permanently deny request ${req.id}`}
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
              })}
            </tbody>
          </table>

          {total > DISPLAY_LIMIT && (
            <p style={seeAllStyle}>
              <Link to="/requests" style={linkStyle}>
                See all {total} requests
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// CohortsWidget
// ---------------------------------------------------------------------------

function CohortsWidget() {
  const { data: cohorts, isLoading, error } = useQuery<Cohort[], Error>({
    queryKey: ['admin', 'dashboard', 'cohorts'],
    queryFn: fetchCohorts,
  });

  return (
    <section style={widgetStyle} aria-labelledby="cohorts-heading">
      <div style={widgetHeaderRowStyle}>
        <h3 id="cohorts-heading" style={widgetHeadingStyle}>
          Cohorts
        </h3>
        <Link to="/cohorts" style={manageLinkStyle}>
          Manage &rarr;
        </Link>
      </div>

      {isLoading && <p style={loadingStyle}>Loading cohorts...</p>}

      {error && (
        <p style={errorStyle} role="alert">
          Failed to load cohorts: {error.message}
        </p>
      )}

      {!isLoading && !error && cohorts && cohorts.length === 0 && (
        <p style={emptyStyle}>No cohorts yet.</p>
      )}

      {!isLoading && !error && cohorts && cohorts.length > 0 && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Cohort Name</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort) => (
              <tr key={cohort.id}>
                <td style={tdStyle}>{cohort.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
