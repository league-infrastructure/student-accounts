/**
 * MergeQueuePanel — admin page for reviewing and acting on merge suggestions.
 *
 * Two views:
 *  1. List view (default) — table of pending + deferred suggestions with a
 *     "Review" button per row.
 *  2. Detail view — side-by-side user comparison with Approve / Reject / Defer
 *     actions.  Approve requires selecting a survivor; the confirmation dialog
 *     warns that the other user will be deactivated.
 *
 * Navigation between views uses local React state rather than URL params so
 * the parent route stays simple (/admin/merge-queue).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Types (mirror server/src/services/merge-suggestion.service.ts projections)
// ---------------------------------------------------------------------------

interface UserSummary {
  id: number;
  display_name: string;
  primary_email: string;
}

interface MergeSuggestionQueueItem {
  id: number;
  user_a: UserSummary;
  user_b: UserSummary;
  haiku_confidence: number;
  haiku_rationale: string | null;
  status: string;
  created_at: string;
}

interface LoginEntry {
  id: number;
  provider: string;
  provider_email: string | null;
}

interface ExternalAccountEntry {
  id: number;
  type: string;
  status: string;
}

interface UserDetail {
  id: number;
  display_name: string;
  primary_email: string;
  cohort_id: number | null;
  logins: LoginEntry[];
  external_accounts: ExternalAccountEntry[];
}

interface MergeSuggestionDetail {
  id: number;
  user_a: UserDetail;
  user_b: UserDetail;
  haiku_confidence: number;
  haiku_rationale: string | null;
  status: string;
  decided_by: number | null;
  decided_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchQueueItems(): Promise<MergeSuggestionQueueItem[]> {
  const res = await fetch('/api/admin/merge-queue', { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchDetail(id: number): Promise<MergeSuggestionDetail> {
  const res = await fetch(`/api/admin/merge-queue/${id}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function approveSuggestion(args: { id: number; survivorId: number }): Promise<void> {
  const res = await fetch(`/api/admin/merge-queue/${args.id}/approve`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ survivorId: args.survivorId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

async function rejectSuggestion(id: number): Promise<void> {
  const res = await fetch(`/api/admin/merge-queue/${id}/reject`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

async function deferSuggestion(id: number): Promise<void> {
  const res = await fetch(`/api/admin/merge-queue/${id}/defer`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Spinner (same pattern as SyncPanel)
// ---------------------------------------------------------------------------

let spinnerStyleInjected = false;

function Spinner() {
  if (!spinnerStyleInjected && typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = '@keyframes mqsp-rotate { to { transform: rotate(360deg); } }';
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
// MergeQueuePanel — top-level component
// ---------------------------------------------------------------------------

export default function MergeQueuePanel() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (selectedId !== null) {
    return (
      <DetailView
        id={selectedId}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return <ListView onReview={(id) => setSelectedId(id)} />;
}

// ---------------------------------------------------------------------------
// ListView
// ---------------------------------------------------------------------------

function ListView({ onReview }: { onReview: (id: number) => void }) {
  const { data: items, isLoading, error } = useQuery<MergeSuggestionQueueItem[], Error>({
    queryKey: ['admin', 'merge-queue'],
    queryFn: fetchQueueItems,
  });

  if (isLoading) {
    return <p style={loadingStyle}>Loading merge queue...</p>;
  }

  if (error) {
    return <p style={errorTextStyle}>Failed to load merge queue: {error.message}</p>;
  }

  const pendingCount = (items ?? []).filter((i) => i.status === 'pending').length;

  return (
    <div>
      <div style={headerRowStyle}>
        <h2 style={headingStyle}>Merge Queue</h2>
        {pendingCount > 0 && (
          <span style={countBadgeStyle}>{pendingCount} pending</span>
        )}
      </div>

      {items && items.length === 0 ? (
        <p style={emptyStyle}>No pending merge suggestions.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>User A</th>
              <th style={thStyle}>User B</th>
              <th style={thStyle}>Confidence</th>
              <th style={thStyle}>Rationale</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((item) => (
              <tr key={item.id}>
                <td style={tdStyle}>
                  <div style={userCellStyle}>
                    <span style={userNameStyle}>{item.user_a.display_name}</span>
                    <span style={userEmailStyle}>{item.user_a.primary_email}</span>
                  </div>
                </td>
                <td style={tdStyle}>
                  <div style={userCellStyle}>
                    <span style={userNameStyle}>{item.user_b.display_name}</span>
                    <span style={userEmailStyle}>{item.user_b.primary_email}</span>
                  </div>
                </td>
                <td style={tdStyle}>
                  <span style={confidenceStyle(item.haiku_confidence)}>
                    {Math.round(item.haiku_confidence * 100)}%
                  </span>
                </td>
                <td style={tdStyle}>
                  <span style={rationaleStyle}>
                    {truncate(item.haiku_rationale ?? '', 80)}
                  </span>
                </td>
                <td style={tdStyle}>
                  <StatusBadge status={item.status} />
                </td>
                <td style={tdStyle}>
                  <button
                    style={reviewButtonStyle}
                    onClick={() => onReview(item.id)}
                    aria-label={`Review suggestion ${item.id}`}
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DetailView
// ---------------------------------------------------------------------------

function DetailView({ id, onBack }: { id: number; onBack: () => void }) {
  const queryClient = useQueryClient();

  const { data: detail, isLoading, error } = useQuery<MergeSuggestionDetail, Error>({
    queryKey: ['admin', 'merge-queue', id],
    queryFn: () => fetchDetail(id),
  });

  const [survivor, setSurvivor] = useState<'a' | 'b' | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const approveMutation = useMutation<void, Error, { id: number; survivorId: number }>({
    mutationFn: approveSuggestion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'merge-queue'] });
      onBack();
    },
    onError: (err) => {
      setActionError(err.message);
      setShowConfirm(false);
    },
  });

  const rejectMutation = useMutation<void, Error, number>({
    mutationFn: rejectSuggestion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'merge-queue'] });
      onBack();
    },
    onError: (err) => {
      setActionError(err.message);
    },
  });

  const deferMutation = useMutation<void, Error, number>({
    mutationFn: deferSuggestion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'merge-queue'] });
    },
    onError: (err) => {
      setActionError(err.message);
    },
  });

  if (isLoading) {
    return (
      <div>
        <button style={backButtonStyle} onClick={onBack}>&larr; Back to queue</button>
        <p style={loadingStyle}>Loading suggestion details...</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div>
        <button style={backButtonStyle} onClick={onBack}>&larr; Back to queue</button>
        <p style={errorTextStyle}>
          Failed to load suggestion: {error?.message ?? 'Unknown error'}
        </p>
      </div>
    );
  }

  const anyPending =
    approveMutation.isPending || rejectMutation.isPending || deferMutation.isPending;

  const survivorUser = survivor === 'a' ? detail.user_a : survivor === 'b' ? detail.user_b : null;
  const nonSurvivorUser =
    survivor === 'a' ? detail.user_b : survivor === 'b' ? detail.user_a : null;

  function handleApproveClick() {
    if (!survivorUser) return;
    setActionError(null);
    setShowConfirm(true);
  }

  function handleConfirmApprove() {
    if (!survivorUser) return;
    approveMutation.mutate({ id: detail!.id, survivorId: survivorUser.id });
  }

  return (
    <div>
      <button style={backButtonStyle} onClick={onBack}>&larr; Back to queue</button>

      <h2 style={headingStyle}>Review Merge Suggestion #{detail.id}</h2>

      {/* Confidence + rationale */}
      <div style={confidenceCardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
            Haiku Confidence:
          </span>
          <span style={confidenceStyle(detail.haiku_confidence)}>
            {Math.round(detail.haiku_confidence * 100)}%
          </span>
          <StatusBadge status={detail.status} />
        </div>
        {detail.haiku_rationale && (
          <p style={{ margin: 0, fontSize: 14, color: '#334155' }}>
            {detail.haiku_rationale}
          </p>
        )}
      </div>

      {/* Side-by-side user cards */}
      <div style={userCardsRowStyle}>
        <UserCard
          label="User A"
          user={detail.user_a}
          selected={survivor === 'a'}
          onSelect={() => setSurvivor('a')}
          radioName={`survivor-${detail.id}`}
          radioValue="a"
        />
        <UserCard
          label="User B"
          user={detail.user_b}
          selected={survivor === 'b'}
          onSelect={() => setSurvivor('b')}
          radioName={`survivor-${detail.id}`}
          radioValue="b"
        />
      </div>

      {/* Survivor selector instructions */}
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
        Select the survivor above, then click Approve Merge.  The other user will be
        deactivated and their logins will be transferred to the survivor.
      </p>

      {/* Action buttons */}
      <div style={actionRowStyle}>
        <button
          style={approveButtonStyle(anyPending || survivor === null)}
          disabled={anyPending || survivor === null}
          onClick={handleApproveClick}
          aria-label="Approve merge"
        >
          {approveMutation.isPending ? <><Spinner /> Approving...</> : 'Approve Merge'}
        </button>
        <button
          style={rejectButtonStyle(anyPending)}
          disabled={anyPending}
          onClick={() => { setActionError(null); rejectMutation.mutate(detail.id); }}
          aria-label="Reject suggestion"
        >
          {rejectMutation.isPending ? <><Spinner /> Rejecting...</> : 'Reject'}
        </button>
        <button
          style={deferButtonStyle(anyPending)}
          disabled={anyPending}
          onClick={() => { setActionError(null); deferMutation.mutate(detail.id); }}
          aria-label="Defer suggestion"
        >
          {deferMutation.isPending ? <><Spinner /> Deferring...</> : 'Defer'}
        </button>
      </div>

      {actionError && (
        <div style={errorBannerStyle} role="alert">
          {actionError}
        </div>
      )}

      {/* Confirmation dialog */}
      {showConfirm && survivorUser && nonSurvivorUser && (
        <ConfirmDialog
          survivorName={survivorUser.display_name}
          nonSurvivorName={nonSurvivorUser.display_name}
          isPending={approveMutation.isPending}
          onConfirm={handleConfirmApprove}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UserCard
// ---------------------------------------------------------------------------

interface UserCardProps {
  label: string;
  user: UserDetail;
  selected: boolean;
  onSelect: () => void;
  radioName: string;
  radioValue: string;
}

function UserCard({ label, user, selected, onSelect, radioName, radioValue }: UserCardProps) {
  return (
    <div style={userCardStyle(selected)}>
      <div style={userCardHeaderStyle}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="radio"
            name={radioName}
            value={radioValue}
            checked={selected}
            onChange={onSelect}
            aria-label={`${label} is survivor`}
          />
          <span style={{ fontWeight: 700, fontSize: 14, color: selected ? '#4f46e5' : '#1e293b' }}>
            {label} — {selected ? 'Survivor' : 'Select as survivor'}
          </span>
        </label>
      </div>

      <div style={userCardBodyStyle}>
        <Field label="Name" value={user.display_name} />
        <Field label="Email" value={user.primary_email} />
        <Field label="Cohort ID" value={user.cohort_id !== null ? String(user.cohort_id) : '—'} />

        <div style={{ marginTop: 10 }}>
          <span style={fieldLabelStyle}>Logins ({user.logins.length})</span>
          {user.logins.length === 0 ? (
            <span style={emptyListStyle}>None</span>
          ) : (
            <ul style={listStyle}>
              {user.logins.map((l) => (
                <li key={l.id} style={listItemStyle}>
                  <span style={providerBadgeStyle}>{l.provider}</span>
                  {l.provider_email && (
                    <span style={{ fontSize: 12, color: '#475569' }}>{l.provider_email}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginTop: 10 }}>
          <span style={fieldLabelStyle}>External Accounts ({user.external_accounts.length})</span>
          {user.external_accounts.length === 0 ? (
            <span style={emptyListStyle}>None</span>
          ) : (
            <ul style={listStyle}>
              {user.external_accounts.map((ea) => (
                <li key={ea.id} style={listItemStyle}>
                  <span style={providerBadgeStyle}>{ea.type}</span>
                  <span style={{ fontSize: 12, color: '#475569' }}>{ea.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <span style={fieldLabelStyle}>{label}: </span>
      <span style={{ fontSize: 13, color: '#1e293b' }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConfirmDialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  survivorName: string;
  nonSurvivorName: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  survivorName,
  nonSurvivorName,
  isPending,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Confirm merge">
      <div style={dialogStyle}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>
          Confirm Merge
        </h3>
        <p style={{ fontSize: 14, color: '#334155', margin: '0 0 16px' }}>
          This will merge the two accounts. <strong>{nonSurvivorName}</strong> will be
          deactivated and their logins will be transferred to{' '}
          <strong>{survivorName}</strong>. This action cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            style={cancelButtonStyle}
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            style={confirmButtonStyle(isPending)}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? <><Spinner /> Merging...</> : 'Confirm Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    pending: { bg: '#fef9c3', fg: '#854d0e' },
    deferred: { bg: '#e0f2fe', fg: '#0369a1' },
    approved: { bg: '#dcfce7', fg: '#166534' },
    rejected: { bg: '#fee2e2', fg: '#991b1b' },
  };
  const c = colors[status] ?? { bg: '#f1f5f9', fg: '#475569' };
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 600,
        background: c.bg,
        color: c.fg,
        display: 'inline-block',
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const headingStyle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: 20,
};

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 16,
};

const countBadgeStyle: React.CSSProperties = {
  padding: '2px 10px',
  borderRadius: 9999,
  fontSize: 12,
  fontWeight: 700,
  background: '#fef9c3',
  color: '#854d0e',
  marginBottom: 16, // aligns with heading margin
};

const loadingStyle: React.CSSProperties = {
  color: '#64748b',
};

const errorTextStyle: React.CSSProperties = {
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

const userCellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const userNameStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
};

const userEmailStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
};

function confidenceStyle(conf: number): React.CSSProperties {
  const pct = conf * 100;
  const color = pct >= 80 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
  return {
    fontWeight: 700,
    fontSize: 13,
    color,
  };
}

const rationaleStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#475569',
};

const reviewButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: '#4f46e5',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};

const backButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  marginBottom: 20,
  padding: '5px 12px',
  fontSize: 13,
  background: '#fff',
  color: '#334155',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 500,
};

const confidenceCardStyle: React.CSSProperties = {
  marginBottom: 20,
  padding: '12px 16px',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
};

const userCardsRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 16,
  marginBottom: 20,
};

function userCardStyle(selected: boolean): React.CSSProperties {
  return {
    border: selected ? '2px solid #4f46e5' : '1px solid #e2e8f0',
    borderRadius: 8,
    overflow: 'hidden',
    background: selected ? '#f0f0ff' : '#fafafa',
  };
}

const userCardHeaderStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid #e2e8f0',
  background: 'rgba(255,255,255,0.6)',
};

const userCardBodyStyle: React.CSSProperties = {
  padding: '12px 14px',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#64748b',
};

const listStyle: React.CSSProperties = {
  margin: '4px 0 0',
  paddingLeft: 0,
  listStyle: 'none',
};

const listItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 3,
};

const providerBadgeStyle: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  background: '#e0f2fe',
  color: '#0369a1',
};

const emptyListStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#94a3b8',
  marginTop: 4,
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
  marginBottom: 12,
};

function approveButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 16px',
    fontSize: 14,
    background: disabled ? '#a5b4fc' : '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
  };
}

function rejectButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    fontSize: 14,
    background: disabled ? '#fca5a5' : '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
  };
}

function deferButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    fontSize: 14,
    background: disabled ? '#f1f5f9' : '#fff',
    color: disabled ? '#94a3b8' : '#334155',
    border: '1px solid #cbd5e1',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 500,
  };
}

const errorBannerStyle: React.CSSProperties = {
  marginTop: 4,
  padding: '8px 12px',
  background: '#fef2f2',
  border: '1px solid #fca5a5',
  borderRadius: 4,
  color: '#dc2626',
  fontSize: 13,
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 300,
};

const dialogStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 10,
  padding: '24px 28px',
  maxWidth: 440,
  width: '90%',
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '7px 16px',
  fontSize: 14,
  background: '#fff',
  color: '#334155',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 500,
};

function confirmButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 16px',
    fontSize: 14,
    background: disabled ? '#fca5a5' : '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
  };
}

const spinnerStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 12,
  height: 12,
  border: '2px solid rgba(255,255,255,0.4)',
  borderTopColor: '#fff',
  borderRadius: '50%',
  animation: 'mqsp-rotate 0.7s linear infinite',
};
