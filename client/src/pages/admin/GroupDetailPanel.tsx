/**
 * GroupDetailPanel — /groups/:id admin view (Sprint 012).
 *
 * Mirrors CohortDetailPanel: header with name/description/count,
 * four bulk-action buttons (Create League, Invite Claude, Suspend All,
 * Delete All), live-search add-member, and a member table with
 * per-row Remove.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface GroupInfo {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
}

interface GroupDetail {
  group: GroupInfo;
  users: Member[];
}

interface UserMatch {
  id: number;
  displayName: string;
  email: string;
  matchedOn: string;
}

type AccountType = 'workspace' | 'claude';

interface BulkResult {
  succeeded: number[];
  failed: Array<{
    accountId?: number;
    userId: number;
    userName: string;
    type?: AccountType;
    error: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasAccount(m: Member, type: AccountType, statuses: string[]): boolean {
  return m.externalAccounts.some((a) => a.type === type && statuses.includes(a.status));
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GroupDetailPanel() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounced(searchQuery, 300);
  const [matches, setMatches] = useState<UserMatch[]>([]);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/admin/groups/${id}/members`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as GroupDetail;
      setData(body);
      setEditName(body.group.name);
      setEditDesc(body.group.description ?? '');
    } catch (err: any) {
      setError(err.message || 'Failed to load group');
    }
  }

  useEffect(() => {
    if (id) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Live search effect
  useEffect(() => {
    if (!id) return;
    const q = debouncedQuery.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/admin/groups/${id}/user-search?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: UserMatch[]) => {
        if (!cancelled) setMatches(rows);
      })
      .catch(() => {
        if (!cancelled) setMatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, id]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function addMember(userId: number) {
    setBusy(`add-${userId}`);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/groups/${id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setSearchQuery('');
      setMatches([]);
      await load();
    } catch (err: any) {
      setBanner({ ok: false, msg: err.message || 'Add failed' });
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(userId: number, userName: string) {
    if (!confirm(`Remove ${userName} from this group?`)) return;
    setBusy(`remove-${userId}`);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/groups/${id}/members/${userId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (err: any) {
      setBanner({ ok: false, msg: err.message || 'Remove failed' });
    } finally {
      setBusy(null);
    }
  }

  async function runBulkProvision(accountType: AccountType, label: string) {
    const product = accountType === 'workspace' ? 'League accounts' : 'Claude seats';
    if (!confirm(`Create ${product} for all eligible members of this group?`)) return;
    setBusy(`provision-${accountType}`);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/groups/${id}/bulk-provision`, {
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
        msg:
          `${label}: ${r.succeeded.length} succeeded, ${r.failed.length} failed.` +
          (r.failed.length
            ? ` ${r.failed.map((f) => `${f.userName}: ${f.error}`).join('; ')}`
            : ''),
      });
      await load();
    } catch (err: any) {
      setBanner({ ok: false, msg: err.message || 'Bulk action failed' });
    } finally {
      setBusy(null);
    }
  }

  async function runBulkAll(op: 'suspend' | 'remove', label: string) {
    const verb = op === 'suspend' ? 'Suspend' : 'Delete';
    if (
      !confirm(
        `${verb} EVERY League and Claude account for every active member of this group?`,
      )
    )
      return;
    setBusy(`${op}-all`);
    setBanner(null);
    try {
      const endpoint =
        op === 'suspend'
          ? `/api/admin/groups/${id}/bulk-suspend-all`
          : `/api/admin/groups/${id}/bulk-remove-all`;
      const res = await fetch(endpoint, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as BulkResult | { error?: string };
      if (!res.ok && res.status !== 207) {
        const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const r = body as BulkResult;
      setBanner({
        ok: r.failed.length === 0,
        msg:
          `${label}: ${r.succeeded.length} succeeded, ${r.failed.length} failed.` +
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

  async function saveEdit() {
    setBusy('edit');
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/groups/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDesc.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setEditing(false);
      await load();
    } catch (err: any) {
      setBanner({ ok: false, msg: err.message || 'Save failed' });
    } finally {
      setBusy(null);
    }
  }

  async function deleteGroup() {
    if (!data) return;
    if (
      !confirm(
        `Delete group "${data.group.name}"? This removes all memberships. It cannot be undone.`,
      )
    )
      return;
    setBusy('delete');
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/groups/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      navigate('/groups');
    } catch (err: any) {
      setBanner({ ok: false, msg: err.message || 'Delete failed' });
      setBusy(null);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (error) {
    return (
      <div>
        <button onClick={() => navigate('/groups')} style={backBtn}>
          ← Back to Groups
        </button>
        <p style={{ color: '#dc2626' }}>{error}</p>
      </div>
    );
  }
  if (!data) return <p style={{ color: '#64748b' }}>Loading group…</p>;

  const missingClaude = data.users.filter(
    (m) => !hasAccount(m, 'claude', ['active', 'pending']),
  ).length;

  return (
    <div>
      <button onClick={() => navigate('/groups')} style={backBtn}>
        ← Back to Groups
      </button>

      {editing ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            aria-label="Edit group name"
            style={editInput}
          />
          <input
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            aria-label="Edit group description"
            placeholder="Description (optional)"
            style={{ ...editInput, minWidth: 280 }}
          />
          <button onClick={saveEdit} disabled={busy === 'edit'} style={saveBtn}>
            Save
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setEditName(data.group.name);
              setEditDesc(data.group.description ?? '');
            }}
            style={cancelBtn}
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>{data.group.name}</h2>
          <p style={{ color: '#64748b', marginTop: 0, fontSize: 13 }}>
            {data.group.description ? `${data.group.description} · ` : ''}
            {data.users.length} member{data.users.length === 1 ? '' : 's'}
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={() => setEditing(true)} style={secondaryBtn}>
              Edit
            </button>
            <button onClick={deleteGroup} style={dangerSmallBtn}>
              Delete Group
            </button>
          </div>
        </>
      )}

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
          label="Create League"
          disabled={busy !== null || data.users.length === 0}
          busy={busy === 'provision-workspace'}
          kind="primary"
          onClick={() => runBulkProvision('workspace', 'Create League accounts')}
        />
        <BulkButton
          label={`Invite Claude (${missingClaude})`}
          disabled={busy !== null || missingClaude === 0}
          busy={busy === 'provision-claude'}
          kind="primary"
          onClick={() => runBulkProvision('claude', 'Invite to Claude')}
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
      </div>

      {/* Add-member search */}
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search users to add (name, email, login)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search users"
          style={{ ...editInput, width: '100%', maxWidth: 420 }}
        />
        {matches.length > 0 && (
          <div style={searchListStyle}>
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => addMember(m.id)}
                disabled={busy !== null}
                style={searchItemStyle}
              >
                <span style={{ fontWeight: 600 }}>{m.displayName || m.email}</span>
                <span style={{ color: '#64748b', fontSize: 12, marginLeft: 8 }}>
                  {m.email} · matched on {m.matchedOn}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Member table */}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={th}>Name</th>
            <th style={th}>Email</th>
            <th style={th}>League</th>
            <th style={th}>Claude</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {data.users.map((m) => {
            const ws = m.externalAccounts.find((a) => a.type === 'workspace');
            const cl = m.externalAccounts.find((a) => a.type === 'claude');
            return (
              <tr key={m.id}>
                <td style={td}>
                  <Link
                    to={`/users/${m.id}`}
                    style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}
                  >
                    {m.displayName || m.email}
                  </Link>
                </td>
                <td style={td}>{m.email}</td>
                <td style={td}>
                  {ws ? <StatusPill status={ws.status} /> : <em style={{ color: '#94a3b8' }}>none</em>}
                </td>
                <td style={td}>
                  {cl ? <StatusPill status={cl.status} /> : <em style={{ color: '#94a3b8' }}>none</em>}
                </td>
                <td style={td}>
                  <button
                    onClick={() => removeMember(m.id, m.displayName || m.email)}
                    disabled={busy !== null}
                    style={removeBtnStyle}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
          {data.users.length === 0 && (
            <tr>
              <td colSpan={5} style={{ ...td, color: '#94a3b8', textAlign: 'center' }}>
                No members yet. Search above to add one.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents + styles
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
    <button disabled={disabled} onClick={onClick} style={{ ...base, background: color, color: '#fff' }}>
      {busy ? 'Working…' : label}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === 'active' ? '#065f46'
    : status === 'pending' ? '#92400e'
    : status === 'suspended' ? '#9a3412'
    : '#475569';
  const bg =
    status === 'active' ? '#d1fae5'
    : status === 'pending' ? '#fef3c7'
    : status === 'suspended' ? '#fed7aa'
    : '#e2e8f0';
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
const editInput: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 14,
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  minWidth: 240,
};
const saveBtn: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 14,
  background: '#4f46e5',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};
const cancelBtn: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 14,
  background: 'transparent',
  color: '#64748b',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 13,
  background: 'transparent',
  color: '#2563eb',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
};
const dangerSmallBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 13,
  background: 'transparent',
  color: '#dc2626',
  border: '1px solid #fecaca',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
};
const removeBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: 'transparent',
  color: '#dc2626',
  border: '1px solid #fecaca',
  borderRadius: 4,
  cursor: 'pointer',
};
const searchListStyle: React.CSSProperties = {
  marginTop: 4,
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  maxWidth: 420,
  overflow: 'hidden',
};
const searchItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 10px',
  fontSize: 13,
  background: '#fff',
  border: 'none',
  borderBottom: '1px solid #f1f5f9',
  cursor: 'pointer',
};
