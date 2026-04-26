/**
 * CohortDetailPanel — per-cohort admin view at /cohorts/:id.
 *
 * Read-only view of cohort membership. Cohorts are the Google Workspace
 * OU concept; account management (workspace, Claude, LLM proxy) happens
 * on the group detail page, not here. The "Sync to group" button copies
 * this cohort's active students into a group with the same name and
 * navigates there.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PassphraseCard } from '../../components/PassphraseCard';

interface ExternalAccount {
  type: string;
  status: string;
  externalId: string | null;
}

interface Member {
  id: number;
  displayName: string | null;
  email: string;
  role: string;
  externalAccounts: ExternalAccount[];
}

interface CohortDetail {
  cohort: { id: number; name: string; google_ou_path: string | null };
  users: Member[];
}

interface SyncToGroupResult {
  groupId: number;
  groupName: string;
  created: boolean;
  addedCount: number;
  alreadyMemberCount: number;
  eligibleCount: number;
}

/** A cohort is a Google Workspace OU — every active member has a League
 *  account by construction. Detection looks at the primary email rather
 *  than ExternalAccount rows, which workspace sync doesn't create. */
function hasLeagueAccount(m: Member): boolean {
  const email = (m.email ?? '').toLowerCase();
  if (/@([a-z0-9-]+\.)?jointheleague\.org$/.test(email)) return true;
  return m.externalAccounts.some(
    (a) => a.type === 'workspace' && ['active', 'pending'].includes(a.status),
  );
}

export default function CohortDetailPanel() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const numericId = id ? parseInt(id, 10) : NaN;

  // Nested under ['admin', 'cohorts', ...] so the SSE 'cohorts' and
  // 'users' topics both cascade here when membership or external accounts
  // change for this cohort's students.
  const detailQuery = useQuery<CohortDetail>({
    queryKey: ['admin', 'cohorts', numericId, 'detail'],
    queryFn: async () => {
      const res = await fetch(`/api/admin/cohorts/${id}/members`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: Number.isFinite(numericId),
  });

  const data = detailQuery.data ?? null;
  const error = detailQuery.error ? (detailQuery.error as Error).message : null;

  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);

  const syncMutation = useMutation<SyncToGroupResult, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/cohorts/${id}/sync-to-group`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (result) => {
      const verb = result.created ? 'Created group' : 'Updated group';
      setBanner({
        ok: true,
        msg: `${verb} "${result.groupName}": added ${result.addedCount}, already a member: ${result.alreadyMemberCount}.`,
      });
      queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
      navigate(`/groups/${result.groupId}`);
    },
    onError: (err) => {
      setBanner({ ok: false, msg: err.message || 'Sync to group failed' });
    },
  });

  if (error) {
    return (
      <div>
        <button onClick={() => navigate('/cohorts')} style={backBtn}>← Back to Cohorts</button>
        <p style={{ color: '#dc2626' }}>{error}</p>
      </div>
    );
  }
  if (!data) return <p style={{ color: '#64748b' }}>Loading cohort…</p>;

  const activeStudents = data.users.filter((m) => m.role === 'student').length;

  return (
    <div>
      <button onClick={() => navigate('/cohorts')} style={backBtn}>← Back to Cohorts</button>
      <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>{data.cohort.name}</h2>
      <p style={{ color: '#64748b', marginTop: 0, fontSize: 13 }}>
        OU: <code>{data.cohort.google_ou_path ?? '—'}</code> · {data.users.length} active member{data.users.length === 1 ? '' : 's'}
      </p>

      {banner && (
        <div
          role={banner.ok ? 'status' : 'alert'}
          style={{
            padding: 10,
            marginBottom: 16,
            borderRadius: 6,
            background: banner.ok ? '#d1fae5' : '#fee2e2',
            color: banner.ok ? '#065f46' : '#991b1b',
            fontSize: 13,
          }}
        >
          {banner.msg}
        </div>
      )}

      <div
        style={{
          marginBottom: 16,
          padding: 12,
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          fontSize: 13,
          color: '#475569',
        }}
      >
        To grant workspace, Claude, or LLM proxy access to this class, sync
        the cohort into a group and manage accounts from the group page.
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || activeStudents === 0}
            style={syncButtonStyle(syncMutation.isPending || activeStudents === 0)}
          >
            {syncMutation.isPending ? 'Syncing…' : `Sync to group "${data.cohort.name}"`}
          </button>
        </div>
      </div>

      {/* Passphrase card */}
      {Number.isFinite(numericId) && (
        <PassphraseCard
          scopeKind="cohort"
          scopeId={numericId}
          scopeName={data.cohort.name}
        />
      )}

      {/* Members table (read-only) */}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={th}>Name</th>
            <th style={th}>Email</th>
            <th style={th}>League</th>
            <th style={th}>Claude</th>
          </tr>
        </thead>
        <tbody>
          {data.users.map((m) => {
            const ws = m.externalAccounts.find((a) => a.type === 'workspace');
            const cl = m.externalAccounts.find((a) => a.type === 'claude');
            return (
              <tr key={m.id}>
                <td style={td}>
                  <Link to={`/users/${m.id}`} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>
                    {m.displayName || m.email}
                  </Link>
                </td>
                <td style={td}>{m.email}</td>
                <td style={td}>
                  {ws ? (
                    <StatusPill status={ws.status} />
                  ) : hasLeagueAccount(m) ? (
                    <StatusPill status="active" />
                  ) : (
                    <em style={{ color: '#94a3b8' }}>none</em>
                  )}
                </td>
                <td style={td}>{cl ? <StatusPill status={cl.status} /> : <em style={{ color: '#94a3b8' }}>none</em>}</td>
              </tr>
            );
          })}
          {data.users.length === 0 && (
            <tr>
              <td colSpan={4} style={{ ...td, color: '#94a3b8', textAlign: 'center' }}>
                No active members in this cohort.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper components + styles
// ---------------------------------------------------------------------------

function StatusPill({ status }: { status: string }) {
  const color =
    status === 'active' ? '#065f46' : status === 'pending' ? '#92400e' : status === 'suspended' ? '#9a3412' : '#475569';
  const bg =
    status === 'active' ? '#d1fae5' : status === 'pending' ? '#fef3c7' : status === 'suspended' ? '#fed7aa' : '#e2e8f0';
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', background: bg, color, borderRadius: 999, fontWeight: 600 }}>
      {status}
    </span>
  );
}

function syncButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    background: disabled ? '#cbd5e1' : '#0891b2',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid #e2e8f0',
  fontWeight: 600,
  fontSize: 13,
  color: '#64748b',
};
const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #f1f5f9' };
const backBtn: React.CSSProperties = {
  padding: '4px 10px',
  marginBottom: 12,
  fontSize: 13,
  background: 'transparent',
  color: '#2563eb',
  border: 'none',
  cursor: 'pointer',
};
