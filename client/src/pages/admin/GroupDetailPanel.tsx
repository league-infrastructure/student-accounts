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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PassphraseCard } from '../../components/PassphraseCard';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useToast } from '../../context/ToastContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TriState = 'all-on' | 'all-off' | 'mixed';
type PermField = 'allowsOauthClient' | 'allowsLlmProxy' | 'allowsLeagueAccount';

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
  llmProxyToken: {
    status: 'active' | 'pending' | 'none';
  };
  allowsOauthClient: boolean;
  allowsLlmProxy: boolean;
  allowsLeagueAccount: boolean;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps a PermField to the snake_case API key used in PATCH bodies. */
const FIELD_TO_API_KEY: Record<PermField, string> = {
  allowsOauthClient: 'allows_oauth_client',
  allowsLlmProxy: 'allows_llm_proxy',
  allowsLeagueAccount: 'allows_league_account',
};

/** Friendly labels for toast messages, indexed by camelCase or snake_case. */
const PERM_LABEL: Record<string, string> = {
  allowsOauthClient: 'OAuth Client',
  allowsLlmProxy: 'LLM Proxy',
  allowsLeagueAccount: 'League Account',
  allows_oauth_client: 'OAuth Client',
  allows_llm_proxy: 'LLM Proxy',
  allows_league_account: 'League Account',
};

/**
 * Derives the tri-state for a permission column from the current user list.
 * Returns 'mixed' for an empty array.
 */
function triState(field: PermField, users: Member[]): TriState {
  if (users.length === 0) return 'mixed';
  const onCount = users.filter((u) => u[field]).length;
  if (onCount === users.length) return 'all-on';
  if (onCount === 0) return 'all-off';
  return 'mixed';
}

/** Stateless three-state indicator button. */
function ColumnTriToggle({
  state,
  onClick,
  busy,
}: {
  state: TriState;
  onClick: () => void;
  busy: boolean;
}) {
  const glyph = state === 'all-on' ? '☑' : state === 'all-off' ? '☒' : '☐';
  const title =
    state === 'all-on' ? 'All on — click to turn all off' : 'Click to turn all on';
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        background: 'none',
        border: 'none',
        cursor: busy ? 'default' : 'pointer',
        fontSize: 14,
        padding: '0 2px',
        lineHeight: 1,
      }}
      title={title}
      aria-label={title}
    >
      {glyph}
    </button>
  );
}

/** Same rule as the Users page: only student-role users are suspendable. */
function isSuspendEligible(m: Member): boolean {
  const r = m.role.toLowerCase();
  return r !== 'admin' && r !== 'staff';
}

interface BulkOutcome {
  succeeded: number[];
  failed: Array<{ userId: number; error?: string }>;
  skipped?: number[];
}

/** POST a JSON body to a bulk endpoint; 207 (partial success) is not an error. */
async function postBulk(url: string, body: unknown): Promise<BulkOutcome> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 207) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const json = (await res.json().catch(() => ({}))) as Partial<BulkOutcome>;
  return {
    succeeded: json.succeeded ?? [],
    failed: json.failed ?? [],
    skipped: json.skipped ?? [],
  };
}

function bulkButtonStyle(variant: 'secondary' | 'danger' | 'warning'): React.CSSProperties {
  const bg = variant === 'danger' ? '#dc2626' : variant === 'warning' ? '#d97706' : '#e2e8f0';
  const fg = variant === 'secondary' ? '#1e293b' : '#fff';
  return {
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    background: bg,
    color: fg,
  };
}

/** Header select-all checkbox with an indeterminate state. */
function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  return (
    <input
      type="checkbox"
      aria-label="Select all members"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      onChange={onChange}
      style={{ cursor: 'pointer' }}
    />
  );
}

type ConfirmState =
  | { open: false }
  | {
      open: true;
      title: string;
      message: string;
      confirmLabel: string;
      onConfirm: () => void;
    };

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
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const numericId = id ? parseInt(id, 10) : NaN;

  // Nested under ['admin', 'groups', ...] so the SSE 'groups' topic
  // cascades here when another admin mutates this group's membership.
  const detailQuery = useQuery<GroupDetail>({
    queryKey: ['admin', 'groups', numericId, 'detail'],
    queryFn: async () => {
      const res = await fetch(`/api/admin/groups/${id}/members`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: Number.isFinite(numericId),
  });

  const data = detailQuery.data ?? null;
  const error = detailQuery.error ? (detailQuery.error as Error).message : null;
  const load = (): Promise<void> =>
    queryClient
      .invalidateQueries({
        queryKey: ['admin', 'groups', numericId, 'detail'],
      })
      .then(() => undefined);

  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);

  // Click-to-edit name (Ticket 007)
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounced(searchQuery, 300);
  const [matches, setMatches] = useState<UserMatch[]>([]);

  // Per-row permission patch state
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [provisioningIds, setProvisioningIds] = useState<Set<number>>(new Set());

  // Column-level bulk-action state
  const [columnBusy, setColumnBusy] = useState<PermField | null>(null);

  // Row selection (member user ids)
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmState, setConfirmState] = useState<ConfirmState>({ open: false });
  const [bulkBusy, setBulkBusy] = useState(false);

  // Group changed: drop the selection.
  useEffect(() => {
    setSelected(new Set());
  }, [numericId]);

  // Member list reloaded: drop ids that are no longer members.
  useEffect(() => {
    const users = detailQuery.data?.users;
    if (!users) return;
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(users.map((u) => u.id));
      const next = new Set([...prev].filter((uid) => present.has(uid)));
      return next.size === prev.size ? prev : next;
    });
  }, [detailQuery.data]);

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

  async function removeMember(userId: number) {
    if (!confirm('Remove this member from the group?')) return;
    setBusy(`remove-${userId}`);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/groups/${id}/members/${userId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
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


  function toggleRow(userId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function toggleAll() {
    if (!data) return;
    setSelected((prev) =>
      data.users.length > 0 && data.users.every((u) => prev.has(u.id))
        ? new Set()
        : new Set(data.users.map((u) => u.id)),
    );
  }

  /** Runs a bulk action, then toasts, clears the selection, and reloads. */
  async function runBulk(label: string, action: () => Promise<string>) {
    setConfirmState({ open: false });
    setBulkBusy(true);
    try {
      const msg = await action();
      showToast(msg, 'success');
    } catch (err: any) {
      showToast(`${label} failed: ${err.message || 'unknown error'}`, 'error');
    } finally {
      setBulkBusy(false);
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      await load();
    }
  }

  function summarize(verb: string, r: BulkOutcome): string {
    const n = r.succeeded.length;
    let msg = `${verb} ${n} member${n === 1 ? '' : 's'}`;
    if (r.failed.length > 0) msg += `, ${r.failed.length} failed`;
    if (r.skipped && r.skipped.length > 0) msg += `, ${r.skipped.length} skipped`;
    return msg;
  }

  function openRemoveConfirm(ids: number[]) {
    setConfirmState({
      open: true,
      title: 'Remove from group',
      message: `Remove ${ids.length} member${ids.length === 1 ? '' : 's'} from this group?`,
      confirmLabel: 'Remove',
      onConfirm: () =>
        void runBulk('Remove', async () => {
          const results = await Promise.allSettled(
            ids.map(async (uid) => {
              const res = await fetch(`/api/admin/groups/${id}/members/${uid}`, {
                method: 'DELETE',
              });
              if (!res.ok) throw new Error(`HTTP ${res.status} for user ${uid}`);
            }),
          );
          const failed = results.filter((r) => r.status === 'rejected').length;
          const ok = ids.length - failed;
          return `Removed ${ok} member${ok === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`;
        }),
    });
  }

  function openSuspendConfirm(ids: number[]) {
    setConfirmState({
      open: true,
      title: 'Suspend accounts',
      message: `Suspend every active workspace + Claude account for ${ids.length} student${ids.length === 1 ? '' : 's'} in the selection? Non-student users are skipped.`,
      confirmLabel: 'Suspend',
      onConfirm: () =>
        void runBulk('Suspend', async () =>
          summarize('Suspended accounts for', await postBulk('/api/admin/users/bulk-suspend-accounts', { userIds: ids })),
        ),
    });
  }

  function openRevokeConfirm(ids: number[]) {
    setConfirmState({
      open: true,
      title: 'Revoke LLM Proxy',
      message: `Revoke LLM proxy tokens for ${ids.length} member${ids.length === 1 ? '' : 's'} in the selection? Their tokens will stop working immediately.`,
      confirmLabel: 'Revoke',
      onConfirm: () =>
        void runBulk('Revoke', async () =>
          summarize('Revoked LLM proxy for', await postBulk('/api/admin/users/bulk-revoke-llm-proxy', { userIds: ids })),
        ),
    });
  }

  function openGrantConfirm(ids: number[]) {
    setConfirmState({
      open: true,
      title: 'Grant LLM Proxy',
      message: `Grant LLM proxy tokens (30 days, default budget) to ${ids.length} member${ids.length === 1 ? '' : 's'} in the selection? Members whose group does not allow the LLM proxy are skipped.`,
      confirmLabel: 'Grant',
      onConfirm: () =>
        void runBulk('Grant', async () =>
          summarize(
            'Granted LLM proxy to',
            await postBulk(`/api/admin/groups/${id}/llm-proxy/bulk-grant`, {
              userIds: ids,
              expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
            }),
          ),
        ),
    });
  }

  async function patchUserPermission(
    userId: number,
    field: 'allows_oauth_client' | 'allows_llm_proxy' | 'allows_league_account',
    newValue: boolean,
  ) {
    setPermissionError(null);
    const isLeagueToggleOn = field === 'allows_league_account' && newValue;
    if (isLeagueToggleOn) {
      setProvisioningIds((prev) => new Set(prev).add(userId));
    }
    const member = data?.users.find((u) => u.id === userId);
    const memberName = member?.displayName || member?.email || `user ${userId}`;
    const permLabel = PERM_LABEL[field] ?? field;
    try {
      const res = await fetch(`/api/admin/users/${userId}/permissions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: newValue }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      await load();
      showToast(
        `${permLabel} ${newValue ? 'enabled' : 'disabled'} for ${memberName}`,
        'success',
      );
    } catch (err: any) {
      const msg = err.message || 'Permission update failed';
      setPermissionError(msg);
      showToast(`${permLabel} update failed for ${memberName}: ${msg}`, 'error');
    } finally {
      if (isLeagueToggleOn) {
        setProvisioningIds((prev) => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      }
    }
  }

  async function bulkSetPermission(field: PermField, value: boolean) {
    if (!data) return;
    setColumnBusy(field);
    const apiKey = FIELD_TO_API_KEY[field];
    const permLabel = PERM_LABEL[field] ?? field;
    const total = data.users.length;
    let failed = 0;
    try {
      const results = await Promise.allSettled(
        data.users.map((u) =>
          fetch(`/api/admin/users/${u.id}/permissions`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [apiKey]: value }),
          }).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status} for user ${u.id}`);
          }).catch((err) => {
            console.warn('Bulk PATCH failed for user', u.id, err);
            throw err;
          }),
        ),
      );
      failed = results.filter((r) => r.status === 'rejected').length;
    } finally {
      setColumnBusy(null);
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'groups', numericId, 'detail'],
      });
      const succeeded = total - failed;
      const verb = value ? 'enabled' : 'disabled';
      const memberWord = succeeded === 1 ? 'member' : 'members';
      if (failed === 0) {
        showToast(
          `${permLabel} ${verb} for ${succeeded} ${memberWord}`,
          'success',
        );
      } else if (succeeded > 0) {
        showToast(
          `${permLabel} ${verb} for ${succeeded} ${memberWord}; ${failed} failed`,
          'error',
        );
      } else {
        showToast(`${permLabel} bulk update failed for all ${total} members`, 'error');
      }
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

  async function saveNameEdit() {
    setBusy('edit-name');
    setBanner(null);
    try {
      const trimmed = editingNameValue.trim();
      if (!trimmed) {
        setBanner({ ok: false, msg: 'Group name cannot be empty.' });
        setBusy(null);
        return;
      }
      const res = await fetch(`/api/admin/groups/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          description: data?.group.description ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setIsEditingName(false);
      await load();
    } catch (err: any) {
      setBanner({ ok: false, msg: err.message || 'Save failed' });
    } finally {
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

  const selectedMembers = data.users.filter((u) => selected.has(u.id));
  const allSelected = data.users.length > 0 && selectedMembers.length === data.users.length;
  const suspendIds = selectedMembers.filter(isSuspendEligible).map((u) => u.id);
  const revokeIds = selectedMembers
    .filter((u) => u.llmProxyToken.status === 'active')
    .map((u) => u.id);
  const grantIds = selectedMembers
    .filter((u) => u.llmProxyToken.status === 'none')
    .map((u) => u.id);

  return (
    <div>
      <button onClick={() => navigate('/groups')} style={backBtn}>
        ← Back to Groups
      </button>

      {isEditingName ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <input
            type="text"
            value={editingNameValue}
            onChange={(e) => setEditingNameValue(e.target.value)}
            onBlur={saveNameEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                saveNameEdit();
              } else if (e.key === 'Escape') {
                setIsEditingName(false);
              }
            }}
            autoFocus
            aria-label="Edit group name"
            style={editInput}
          />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <h2
              onClick={() => {
                setIsEditingName(true);
                setEditingNameValue(data.group.name);
              }}
              style={{
                margin: 0,
                fontSize: 22,
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: 4,
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = '#f1f5f9';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              }}
            >
              {data.group.name}
            </h2>
            <button onClick={deleteGroup} style={dangerSmallBtn}>
              Delete Group
            </button>
          </div>
          <p style={{ color: '#64748b', marginTop: 0, fontSize: 13 }}>
            {data.group.description ? `${data.group.description} · ` : ''}
            {data.users.length} member{data.users.length === 1 ? '' : 's'}
          </p>
        </>
      )}

      {/* Passphrase card */}
      {Number.isFinite(numericId) && (
        <PassphraseCard
          scopeKind="group"
          scopeId={numericId}
          scopeName={data.group.name}
        />
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

      {permissionError && (
        <div
          role="alert"
          style={{
            padding: 10,
            marginBottom: 16,
            borderRadius: 6,
            background: '#fee2e2',
            color: '#991b1b',
            fontSize: 13,
          }}
        >
          {permissionError}
        </div>
      )}

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

      {/* Selection toolbar */}
      {selectedMembers.length > 0 && (
        <div
          role="toolbar"
          aria-label="Selected members"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '8px 12px',
            marginBottom: 8,
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: 6,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, marginRight: 8 }}>
            {selectedMembers.length} selected
          </span>
          <button
            type="button"
            style={bulkButtonStyle('danger')}
            disabled={bulkBusy}
            onClick={() => openRemoveConfirm(selectedMembers.map((u) => u.id))}
          >
            Remove from group
          </button>
          <button
            type="button"
            style={bulkButtonStyle('warning')}
            disabled={bulkBusy || suspendIds.length === 0}
            onClick={() => openSuspendConfirm(suspendIds)}
          >
            Suspend accounts
          </button>
          <button
            type="button"
            style={bulkButtonStyle('secondary')}
            disabled={bulkBusy || grantIds.length === 0}
            onClick={() => openGrantConfirm(grantIds)}
          >
            Grant LLM Proxy
          </button>
          <button
            type="button"
            style={bulkButtonStyle('danger')}
            disabled={bulkBusy || revokeIds.length === 0}
            onClick={() => openRevokeConfirm(revokeIds)}
          >
            Revoke LLM Proxy
          </button>
        </div>
      )}

      {/* Member table */}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ ...th, width: 32 }}>
              <SelectAllCheckbox
                checked={allSelected}
                indeterminate={selectedMembers.length > 0 && !allSelected}
                onChange={toggleAll}
              />
            </th>
            <th style={th}>Name</th>
            <th style={th}>Email</th>
            <th style={{ ...th, textAlign: 'center' }}>
              OAuth{' '}
              <ColumnTriToggle
                state={triState('allowsOauthClient', data.users)}
                onClick={() => {
                  const current = triState('allowsOauthClient', data.users);
                  bulkSetPermission('allowsOauthClient', current !== 'all-on');
                }}
                busy={columnBusy === 'allowsOauthClient'}
              />
              {columnBusy === 'allowsOauthClient' && (
                <span style={{ fontSize: 11, display: 'block', color: '#64748b' }}>
                  Updating...
                </span>
              )}
            </th>
            <th style={{ ...th, textAlign: 'center' }}>
              LLM Proxy{' '}
              <ColumnTriToggle
                state={triState('allowsLlmProxy', data.users)}
                onClick={() => {
                  const current = triState('allowsLlmProxy', data.users);
                  bulkSetPermission('allowsLlmProxy', current !== 'all-on');
                }}
                busy={columnBusy === 'allowsLlmProxy'}
              />
              {columnBusy === 'allowsLlmProxy' && (
                <span style={{ fontSize: 11, display: 'block', color: '#64748b' }}>
                  Updating...
                </span>
              )}
            </th>
            <th style={{ ...th, textAlign: 'center' }}>
              Lg Acct{' '}
              <ColumnTriToggle
                state={triState('allowsLeagueAccount', data.users)}
                onClick={() => {
                  const current = triState('allowsLeagueAccount', data.users);
                  bulkSetPermission('allowsLeagueAccount', current !== 'all-on');
                }}
                busy={columnBusy === 'allowsLeagueAccount'}
              />
              {columnBusy === 'allowsLeagueAccount' && (
                <span style={{ fontSize: 11, display: 'block', color: '#64748b' }}>
                  Updating...
                </span>
              )}
            </th>
            <th style={{ ...th, width: 80, textAlign: 'center' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.users.map((m) => {
            return (
              <tr key={m.id}>
                <td style={td}>
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    aria-label={`Select ${m.displayName || m.email}`}
                    style={{ cursor: 'pointer' }}
                    onChange={() => toggleRow(m.id)}
                  />
                </td>
                <td style={td}>
                  <Link
                    to={`/users/${m.id}`}
                    style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}
                  >
                    {m.displayName || m.email}
                  </Link>
                </td>
                <td style={td}>{m.email}</td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={m.allowsOauthClient}
                    aria-label={`OAuth Client for ${m.displayName || m.email}`}
                    style={{ cursor: 'pointer' }}
                    onChange={(e) =>
                      patchUserPermission(m.id, 'allows_oauth_client', e.target.checked)
                    }
                  />
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={m.allowsLlmProxy}
                    aria-label={`LLM Proxy for ${m.displayName || m.email}`}
                    style={{ cursor: 'pointer' }}
                    onChange={(e) =>
                      patchUserPermission(m.id, 'allows_llm_proxy', e.target.checked)
                    }
                  />
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={m.allowsLeagueAccount}
                    aria-label={`League Account for ${m.displayName || m.email}`}
                    style={{ cursor: 'pointer' }}
                    onChange={(e) =>
                      patchUserPermission(m.id, 'allows_league_account', e.target.checked)
                    }
                  />
                  {provisioningIds.has(m.id) && (
                    <span style={{ fontSize: 11, color: '#64748b', marginLeft: 4 }}>
                      Provisioning…
                    </span>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <button
                    onClick={() => removeMember(m.id)}
                    disabled={busy === `remove-${m.id}`}
                    style={{
                      padding: '4px 8px',
                      fontSize: 12,
                      background: '#fee2e2',
                      color: '#dc2626',
                      border: '1px solid #fecaca',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    {busy === `remove-${m.id}` ? 'Removing…' : 'Remove'}
                  </button>
                </td>
              </tr>
            );
          })}
          {data.users.length === 0 && (
            <tr>
              <td colSpan={7} style={{ ...td, color: '#94a3b8', textAlign: 'center' }}>
                No members yet. Search above to add one.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {confirmState.open && (
        <ConfirmDialog
          open
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState({ open: false })}
          danger
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents + styles
// ---------------------------------------------------------------------------

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
