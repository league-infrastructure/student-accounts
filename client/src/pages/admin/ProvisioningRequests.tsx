/**
 * ProvisioningRequests — admin page for managing pending provisioning requests.
 *
 * Fetches pending requests from GET /api/admin/provisioning-requests and
 * displays them in a table with Approve / Reject actions per row.
 *
 * When approving a workspace request fails because the user has no cohort
 * assigned, the row shows an inline cohort dropdown so the admin can pick
 * one and re-approve without leaving the page.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProvisioningRequest {
  id: number;
  userId: number;
  userName: string | null;
  userEmail: string;
  requestedType: 'workspace' | 'claude';
  createdAt: string;
}

interface Cohort {
  id: number;
  name: string;
  google_ou_path: string | null;
}

interface ApprovePayload {
  id: number;
  cohortId?: number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchPendingRequests(): Promise<ProvisioningRequest[]> {
  const res = await fetch('/api/admin/provisioning-requests');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchCohorts(): Promise<Cohort[]> {
  const res = await fetch('/api/admin/cohorts');
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

async function rejectRequest(id: number): Promise<void> {
  const res = await fetch(`/api/admin/provisioning-requests/${id}/reject`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

function isMissingCohortError(msg: string): boolean {
  return /cohort/i.test(msg) && /(assign|assigned|not have)/i.test(msg);
}

// ---------------------------------------------------------------------------
// ProvisioningRequests component
// ---------------------------------------------------------------------------

export default function ProvisioningRequests() {
  const queryClient = useQueryClient();
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  // When a row's approval failed because the user has no cohort, we remember
  // the id → selected cohort id (0 = none picked yet).
  const [cohortPickerFor, setCohortPickerFor] = useState<Record<number, number>>({});

  const { data: requests, isLoading, error } = useQuery<ProvisioningRequest[], Error>({
    queryKey: ['admin', 'provisioning-requests'],
    queryFn: fetchPendingRequests,
  });

  // Cohorts are only needed when a cohort picker is shown, but TanStack
  // Query caches well — fetching eagerly keeps the approve click snappy.
  const { data: cohorts } = useQuery<Cohort[], Error>({
    queryKey: ['admin', 'cohorts'],
    queryFn: fetchCohorts,
  });

  const approveMutation = useMutation<void, Error, ApprovePayload>({
    mutationFn: approveRequest,
    onSuccess: (_data, { id }) => {
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'provisioning-requests'] });
    },
    onError: (err, { id }) => {
      setRowErrors((prev) => ({ ...prev, [id]: err.message }));
      if (isMissingCohortError(err.message)) {
        setCohortPickerFor((prev) => (prev[id] != null ? prev : { ...prev, [id]: 0 }));
      }
    },
  });

  const rejectMutation = useMutation<void, Error, number>({
    mutationFn: rejectRequest,
    onSuccess: (_data, id) => {
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['admin', 'provisioning-requests'] });
    },
    onError: (err, id) => {
      setRowErrors((prev) => ({ ...prev, [id]: err.message }));
    },
  });

  if (isLoading) {
    return <p style={loadingStyle}>Loading provisioning requests...</p>;
  }

  if (error) {
    return (
      <p style={errorStyle}>
        Failed to load provisioning requests: {error.message}
      </p>
    );
  }

  return (
    <div>
      <h2 style={headingStyle}>Provisioning Requests</h2>

      {requests && requests.length === 0 ? (
        <p style={emptyStyle}>No pending provisioning requests.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Student Name</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Request Type</th>
              <th style={thStyle}>Requested On</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(requests ?? []).map((req) => {
              const isPending =
                approveMutation.isPending || rejectMutation.isPending;
              const rowError = rowErrors[req.id];
              const pickerCohortId = cohortPickerFor[req.id];
              const showPicker = pickerCohortId != null;

              return (
                <tr key={req.id}>
                  <td style={tdStyle}>{req.userName ?? '-'}</td>
                  <td style={tdStyle}>{req.userEmail}</td>
                  <td style={tdStyle}>{req.requestedType}</td>
                  <td style={tdStyle}>
                    {new Date(req.createdAt).toLocaleDateString()}
                  </td>
                  <td style={tdStyle}>
                    <div style={actionsCellStyle}>
                      {showPicker ? (
                        <>
                          <select
                            style={selectStyle}
                            value={pickerCohortId || ''}
                            disabled={isPending}
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
                            disabled={isPending || !pickerCohortId}
                            onClick={() =>
                              approveMutation.mutate({
                                id: req.id,
                                cohortId: pickerCohortId,
                              })
                            }
                            aria-label={`Approve request ${req.id} with selected cohort`}
                          >
                            Approve with cohort
                          </button>
                          <button
                            style={cancelButtonStyle}
                            disabled={isPending}
                            onClick={() =>
                              setCohortPickerFor((prev) => {
                                const next = { ...prev };
                                delete next[req.id];
                                return next;
                              })
                            }
                            aria-label={`Cancel cohort picker for request ${req.id}`}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            style={approveButtonStyle}
                            disabled={isPending}
                            onClick={() => approveMutation.mutate({ id: req.id })}
                            aria-label={`Approve request ${req.id}`}
                          >
                            Approve
                          </button>
                          <button
                            style={rejectButtonStyle}
                            disabled={isPending}
                            onClick={() => rejectMutation.mutate(req.id)}
                            aria-label={`Reject request ${req.id}`}
                          >
                            Reject
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

const loadingStyle: React.CSSProperties = {
  color: '#64748b',
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
};

const emptyStyle: React.CSSProperties = {
  color: '#94a3b8',
  textAlign: 'center',
  marginTop: 24,
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

const rejectButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: '#dc2626',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: '#f1f5f9',
  color: '#1e293b',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 500,
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
