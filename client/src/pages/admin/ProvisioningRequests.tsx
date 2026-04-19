/**
 * ProvisioningRequests — admin page for managing pending provisioning requests.
 *
 * Fetches pending requests from GET /api/admin/provisioning-requests and
 * displays them in a table with Approve / Reject actions per row.
 *
 * Error handling:
 *  - Page-level loading/error state for the initial fetch.
 *  - Inline per-row error message on action failure (approve or reject).
 *  - On success the row is removed from the list (via query invalidation).
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

async function approveRequest(id: number): Promise<void> {
  const res = await fetch(`/api/admin/provisioning-requests/${id}/approve`, {
    method: 'POST',
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

// ---------------------------------------------------------------------------
// ProvisioningRequests component
// ---------------------------------------------------------------------------

export default function ProvisioningRequests() {
  const queryClient = useQueryClient();
  // Per-row error messages keyed by request id
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  const { data: requests, isLoading, error } = useQuery<ProvisioningRequest[], Error>({
    queryKey: ['admin', 'provisioning-requests'],
    queryFn: fetchPendingRequests,
  });

  const approveMutation = useMutation<void, Error, number>({
    mutationFn: approveRequest,
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

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

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
                      <button
                        style={approveButtonStyle}
                        disabled={isPending}
                        onClick={() => approveMutation.mutate(req.id)}
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

const inlineErrorStyle: React.CSSProperties = {
  color: '#dc2626',
  fontSize: 12,
};
