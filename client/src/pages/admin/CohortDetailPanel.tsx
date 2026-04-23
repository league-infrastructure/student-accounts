/**
 * CohortDetailPanel — per-cohort admin view at /cohorts/:id.
 *
 * Lists every active student in the cohort with their current League and
 * Claude account status. Bulk action buttons at the top perform the same
 * operation on every eligible member of the cohort:
 *
 *  - Create Claude seats (POST /admin/cohorts/:id/bulk-provision claude)
 *    — League accounts cannot be bulk-created from here; cohort membership
 *      already implies a League OU placement.
 *  - Suspend All         (POST /admin/cohorts/:id/bulk-suspend-all)
 *    — Suspends every active workspace + claude ExternalAccount for every
 *      active cohort member.
 *  - Delete All          (POST /admin/cohorts/:id/bulk-remove-all)
 *    — Removes every active + suspended workspace + claude ExternalAccount
 *      for every active cohort member.
 *
 * Each bulk action confirms, then re-fetches the member list and shows the
 * succeeded/failed counts. Failure entries from the *-all endpoints carry
 * a `type` field (workspace | claude) so the banner can render
 * "name (claude): reason".
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
type AllOperation = 'suspend' | 'remove';

interface BulkResult {
  succeeded: number[];
  failed: Array<{
    accountId?: number;
    userId: number;
    userName: string;
    /** Only populated by the *-all endpoints (suspend-all / remove-all). */
    type?: AccountType;
    error: string;
  }>;
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

  /**
   * Run a cohort-wide "suspend all" or "delete all" against every live
   * workspace + claude ExternalAccount for every active member.
   */
  async function runBulkAll(op: AllOperation, label: string) {
    const verb = op === 'suspend' ? 'Suspend' : 'Delete';
    if (
      !confirm(
        `${verb} EVERY League and Claude account for every active student in this cohort?`,
      )
    ) {
      return;
    }

    setBusy(`${op}-all`);
    setBanner(null);
    try {
      const endpoint =
        op === 'suspend'
          ? `/api/admin/cohorts/${id}/bulk-suspend-all`
          : `/api/admin/cohorts/${id}/bulk-remove-all`;
      const res = await fetch(endpoint, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as BulkResult | { error?: string };
      if (!res.ok && res.status !== 207) {
        const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const r = body as BulkResult;
      setBanner({
        ok: r.failed.length === 0,
        msg: `${label}: ${r.succeeded.length} succeeded, ${r.failed.length} failed.` +
          (r.failed.length
            ? ' ' +
              r.failed
                .map((f) => {
                  const t = f.type ? ` (${f.type})` : '';
                  return `${f.userName}${t}: ${f.error}`;
                })
                .join('; ')
            : ''),
      });
      await load();
    } catch (err: any) {
      setBanner({ ok: false, msg: err.message || 'Bulk action failed' });
    } finally {
      setBusy(null);
    }
  }

  async function runBulkLlmProxyGrant() {
    const expiresAtStr = window.prompt(
      'Expiration date/time for the new tokens (ISO 8601, e.g. 2026-05-31T17:00:00Z)',
      new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    );
    if (!expiresAtStr) return;
    const tokenLimitStr = window.prompt(
      'Token limit per user (integer)',
      '1000000',
    );
    if (!tokenLimitStr) return;
    const tokenLimit = parseInt(tokenLimitStr, 10);
    if (!Number.isFinite(tokenLimit) || tokenLimit <= 0) {
      setBanner({ ok: false, msg: 'tokenLimit must be a positive integer.' });
      return;
    }
    setBusy('llm-proxy-grant');
    setBanner(null);
    try {
      const res = await fetch(
        `/api/admin/cohorts/${id}/llm-proxy/bulk-grant`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresAt: expiresAtStr, tokenLimit }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok && res.status !== 207) {
        const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const s = body.succeeded?.length ?? 0;
      const f = body.failed?.length ?? 0;
      const skip = body.skipped?.length ?? 0;
      let csv = '';
      if (body.tokensByUser) {
        csv = Object.entries(body.tokensByUser)
          .map(([uid, tok]) => `${uid},${tok}`)
          .join('\n');
      }
      setBanner({
        ok: f === 0,
        msg:
          `LLM proxy grant: ${s} succeeded, ${f} failed, ${skip} skipped.` +
          (csv ? `\nTokens (user_id,token):\n${csv}` : ''),
      });
    } catch (err: any) {
      setBanner({ ok: false, msg: err.message || 'LLM proxy grant failed' });
    } finally {
      setBusy(null);
    }
  }

  async function runBulkLlmProxyRevoke() {
    if (
      !confirm(
        'Revoke LLM proxy access for every student in this cohort who has an active token?',
      )
    )
      return;
    setBusy('llm-proxy-revoke');
    setBanner(null);
    try {
      const res = await fetch(
        `/api/admin/cohorts/${id}/llm-proxy/bulk-revoke`,
        { method: 'POST' },
      );
      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok && res.status !== 207) {
        const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const s = body.succeeded?.length ?? 0;
      const f = body.failed?.length ?? 0;
      const skip = body.skipped?.length ?? 0;
      setBanner({
        ok: f === 0,
        msg: `LLM proxy revoke: ${s} succeeded, ${f} failed, ${skip} skipped.`,
      });
    } catch (err: any) {
      setBanner({ ok: false, msg: err.message || 'LLM proxy revoke failed' });
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

  const missingClaude = data.users.filter(
    (m) => m.role === 'student' && !hasAccount(m, 'claude', ['active', 'pending']),
  ).length;

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
          label={`Create Claude (${missingClaude})`}
          disabled={busy !== null || missingClaude === 0}
          busy={busy === 'provision-claude'}
          kind="primary"
          onClick={() => runBulk('provision', 'claude', 'Create Claude seats')}
        />
        <BulkButton
          label="Suspend All"
          disabled={busy !== null || data.users.length === 0}
          busy={busy === 'suspend-all'}
          kind="warn"
          onClick={() => runBulkAll('suspend', 'Suspend all accounts')}
        />
        <BulkButton
          label="Delete All"
          disabled={busy !== null || data.users.length === 0}
          busy={busy === 'remove-all'}
          kind="danger"
          onClick={() => runBulkAll('remove', 'Delete all accounts')}
        />
        <BulkButton
          label="Grant LLM Proxy"
          disabled={busy !== null || data.users.length === 0}
          busy={busy === 'llm-proxy-grant'}
          kind="primary"
          onClick={runBulkLlmProxyGrant}
        />
        <BulkButton
          label="Revoke LLM Proxy"
          disabled={busy !== null || data.users.length === 0}
          busy={busy === 'llm-proxy-revoke'}
          kind="warn"
          onClick={runBulkLlmProxyRevoke}
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
