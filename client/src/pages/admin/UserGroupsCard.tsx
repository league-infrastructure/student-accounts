/**
 * UserGroupsCard — lists the app-level Group memberships of a single user
 * with inline Add + Remove (Sprint 012 T006).
 *
 * Rendered as an AccountCard-style section on the admin user detail page.
 *
 * Data lifecycle:
 *   GET    /api/admin/users/:id/groups             — user's memberships
 *   GET    /api/admin/groups                       — all groups (for Add)
 *   POST   /api/admin/groups/:groupId/members      — add by userId
 *   DELETE /api/admin/groups/:groupId/members/:userId — remove
 */

import { useCallback, useEffect, useState } from 'react';

interface GroupSummary {
  id: number;
  name: string;
  description?: string | null;
  memberCount?: number;
  createdAt?: string;
}

interface UserMembership {
  id: number;
  name: string;
}

interface Props {
  userId: number;
  /** Displayed in confirm dialogs. */
  userName?: string;
}

export default function UserGroupsCard({ userId, userName }: Props) {
  const [memberships, setMemberships] = useState<UserMembership[] | null>(null);
  const [allGroups, setAllGroups] = useState<GroupSummary[] | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [memRes, allRes] = await Promise.all([
        fetch(`/api/admin/users/${userId}/groups`),
        fetch('/api/admin/groups'),
      ]);
      if (!memRes.ok) throw new Error(`HTTP ${memRes.status}`);
      if (!allRes.ok) throw new Error(`HTTP ${allRes.status}`);
      const mems = (await memRes.json()) as UserMembership[];
      const alls = (await allRes.json()) as GroupSummary[];
      setMemberships(mems);
      setAllGroups(alls);
    } catch (e: any) {
      setErr(e.message ?? 'Failed to load groups');
    }
  }, [userId]);

  useEffect(() => {
    if (!Number.isFinite(userId)) return;
    void load();
  }, [userId, load]);

  async function remove(group: UserMembership) {
    const msg = `Remove ${userName ?? 'this user'} from "${group.name}"?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/groups/${group.id}/members/${userId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Remove failed');
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!selectedGroupId) return;
    const groupId = parseInt(selectedGroupId, 10);
    if (!Number.isFinite(groupId)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setSelectedGroupId('');
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Add failed');
    } finally {
      setBusy(false);
    }
  }

  if (memberships === null || allGroups === null) {
    return (
      <section style={cardStyle}>
        <h2 style={cardTitleStyle}>Groups</h2>
        {err ? (
          <div role="alert" style={errorStyle}>{err}</div>
        ) : (
          <div style={mutedHintStyle}>Loading…</div>
        )}
      </section>
    );
  }

  const memberList = Array.isArray(memberships) ? memberships : [];
  const groupList = Array.isArray(allGroups) ? allGroups : [];
  const memberIds = new Set(memberList.map((m) => m.id));
  const availableGroups = groupList.filter((g) => !memberIds.has(g.id));

  return (
    <section style={cardStyle}>
      <h2 style={cardTitleStyle}>Groups</h2>

      {err && (
        <div role="alert" style={errorStyle}>
          {err}
        </div>
      )}

      {memberList.length === 0 ? (
        <div style={{ color: '#64748b', fontStyle: 'italic', marginBottom: 10 }}>
          Not in any groups yet.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 10px' }}>
          {memberList.map((g) => (
            <li key={g.id} style={rowStyle}>
              <span style={{ fontWeight: 600 }}>{g.name}</span>
              <button
                onClick={() => remove(g)}
                disabled={busy}
                style={removeBtnStyle}
                aria-label={`Remove from ${g.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {availableGroups.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            disabled={busy}
            aria-label="Select group to add"
            style={selectStyle}
          >
            <option value="">Select a group…</option>
            {availableGroups.map((g) => (
              <option key={g.id} value={String(g.id)}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            onClick={add}
            disabled={busy || !selectedGroupId}
            style={addBtnStyle}
          >
            Add
          </button>
        </div>
      )}
      {availableGroups.length === 0 && memberList.length > 0 && (
        <div style={mutedHintStyle}>Already a member of every existing group.</div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Styles (match UserDetailPanel AccountCard visuals)
// ---------------------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '16px 18px',
  marginBottom: 14,
  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
};
const cardTitleStyle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 14,
  fontWeight: 700,
  color: '#0f172a',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
const mutedHintStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: '#94a3b8',
  fontStyle: 'italic',
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 0',
  borderBottom: '1px solid #f1f5f9',
  fontSize: 14,
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
const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  minWidth: 200,
};
const addBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 13,
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
};
const errorStyle: React.CSSProperties = {
  padding: 8,
  marginBottom: 10,
  background: '#fef2f2',
  color: '#991b1b',
  border: '1px solid #fecaca',
  borderRadius: 6,
  fontSize: 13,
};
