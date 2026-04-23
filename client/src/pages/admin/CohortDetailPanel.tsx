/**
 * CohortDetailPanel — per-cohort admin view at /cohorts/:id.
 *
 * Lists every active student in the cohort with their current League and
 * Claude account status. Bulk action buttons at the top perform the same
 * operation on every eligible member of the cohort:
 *
 *  - Create League accounts (POST /admin/cohorts/:id/bulk-provision workspace)
 *  - Create Claude seats    (POST /admin/cohorts/:id/bulk-provision claude)
 *  - Suspend League         (POST /admin/cohorts/:id/bulk-suspend workspace)
 *  - Suspend Claude         (POST /admin/cohorts/:id/bulk-suspend claude)
 *  - Delete League          (POST /admin/cohorts/:id/bulk-remove  workspace)
 *  - Delete Claude          (POST /admin/cohorts/:id/bulk-remove  claude)
 *
 * Each bulk action confirms, then re-fetches the member list and shows the
 * succeeded/failed counts.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

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

type AccountType = 'workspace' | 'claude';
type Operation = 'provision' | 'suspend' | 'remove';

interface BulkResult {
  succeeded: number[];
  failed: Array<{ accountId?: number; userId: number; userName: string; error: string }>;
}

function hasAccount(m: Member, type: AccountType, statuses: string[]): boolean {
  return m.externalAccounts.some(
    (a) => a.type === type && statuses.includes(a.status),
  );
}

/** A cohort is a Google Workspace OU — every active member has a League
 *  account by construction. Detection looks at the primary email rather
 *  than ExternalAccount rows, which workspace sync doesn't create. */
function hasLeagueAccount(m: Member): boolean {
  const email = (m.email ?? '').toLowerCase();
  if (/@([a-z0-9-]+\.)?jointheleague\.org$/.test(email)) return true;
  return hasAccount(m, 'workspace', ['active', 'pending']);
}

export default function CohortDetailPanel() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<CohortDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/admin/cohorts/${id}/members`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err: any) {
      setError(err.message || 'Failed to load cohort');
    }
  }

  useEffect(() => {
    if (id) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function runBulk(op: Operation, accountType: AccountType, label: string) {
    const verb = op === 'provision' ? 'Create' : op === 'suspend' ? 'Suspend' : 'Delete';
    const product = accountType === 'workspace' ? 'League accounts' : 'Claude seats';
    if (!confirm(`${verb} ${product} for all eligible students in this cohort?`)) return;

    setBusy(`${op}-${accountType}`);
    setBanner(null);
    try {
      const endpoint =
        op === 'provision'
          ? `/api/admin/cohorts/${id}/bulk-provision`
          : op === 'suspend'
            ? `/api/admin/cohorts/${id}/bulk-suspend`
            : `/api/admin/cohorts/${id}/bulk-remove`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountType }),
      });
      const body = (await res.json().catch(() => ({}))) as BulkResult | { error?: string };
      if (!res.ok && res.status !== 207) {
        const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const r = body as BulkResult;
      setBanner({
        ok: r.failed.length === 0,
        msg: `${label}: ${r.succeeded.length} succeeded, ${r.failed.length} failed.` +
          (r.failed.length ? ` ${r.failed.map((f) => `${f.userName}: ${f.error}`).join('; ')}` : ''),
      });
      await load();
    } catch (err: any) {
      setBanner({ ok: false, msg: err.message || 'Bulk action failed' });
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div>
        <button onClick={() => navigate('/cohorts')} style={backBtn}>← Back to Cohorts</button>
        <p style={{ color: '#dc2626' }}>{error}</p>
      </div>
    );
  }
  if (!data) return <p style={{ color: '#64748b' }}>Loading cohort…</p>;

  const missingWorkspace = data.users.filter(
    (m) => m.role === 'student' && !hasLeagueAccount(m),
  ).length;
  const missingClaude = data.users.filter(
    (m) => m.role === 'student' && !hasAccount(m, 'claude', ['active', 'pending']),
  ).length;
  const activeWorkspace = data.users.filter((m) => hasAccount(m, 'workspace', ['active'])).length;
  const activeClaude = data.users.filter((m) => hasAccount(m, 'claude', ['active'])).length;

  return (
    <div>
      <button onClick={() => navigate('/cohorts')} style={backBtn}>← Back to Cohorts</button>
      <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>{data.cohort.name}</h2>
      <p style={{ color: '#64748b', marginTop: 0, fontSize: 13 }}>
        OU: <code>{data.cohort.google_ou_path ?? '—'}</code> · {data.users.length} active member{data.users.length === 1 ? '' : 's'}
      </p>

      {banner && (
        <div
          role="alert"
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

      {/* Bulk action buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <BulkButton
          label={`Create League (${missingWorkspace})`}
          disabled={busy !== null || missingWorkspace === 0}
          busy={busy === 'provision-workspace'}
          kind="primary"
          onClick={() => runBulk('provision', 'workspace', 'Create League accounts')}
        />
        <BulkButton
          label={`Create Claude (${missingClaude})`}
          disabled={busy !== null || missingClaude === 0}
          busy={busy === 'provision-claude'}
          kind="primary"
          onClick={() => runBulk('provision', 'claude', 'Create Claude seats')}
        />
        <BulkButton
          label={`Suspend League (${activeWorkspace})`}
          disabled={busy !== null || activeWorkspace === 0}
          busy={busy === 'suspend-workspace'}
          kind="warn"
          onClick={() => runBulk('suspend', 'workspace', 'Suspend League accounts')}
        />
        <BulkButton
          label={`Suspend Claude (${activeClaude})`}
          disabled={busy !== null || activeClaude === 0}
          busy={busy === 'suspend-claude'}
          kind="warn"
          onClick={() => runBulk('suspend', 'claude', 'Suspend Claude seats')}
        />
        <BulkButton
          label="Delete League"
          disabled={busy !== null}
          busy={busy === 'remove-workspace'}
          kind="danger"
          onClick={() => runBulk('remove', 'workspace', 'Delete League accounts')}
        />
        <BulkButton
          label="Delete Claude"
          disabled={busy !== null}
          busy={busy === 'remove-claude'}
          kind="danger"
          onClick={() => runBulk('remove', 'claude', 'Delete Claude seats')}
        />
      </div>

      {/* Members table */}
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
// Helper components
// ---------------------------------------------------------------------------

function BulkButton({
  label,
  disabled,
  busy,
  kind,
  onClick,
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
  kind: 'primary' | 'warn' | 'danger';
  onClick: () => void;
}) {
  const base: React.CSSProperties = {
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none',
    opacity: disabled ? 0.5 : 1,
  };
  const color = kind === 'primary' ? '#2563eb' : kind === 'warn' ? '#d97706' : '#dc2626';
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{ ...base, background: color, color: '#fff' }}
    >
      {busy ? 'Working…' : label}
    </button>
  );
}

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
