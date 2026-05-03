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
import { Button } from '../../components/ui/button';
import { LlmProxyGrantModal } from '../../components/LlmProxyGrantModal';
import { PassphraseCard } from '../../components/PassphraseCard';

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

  // Row selection (Ticket 007)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounced(searchQuery, 300);
  const [matches, setMatches] = useState<UserMatch[]>([]);

  const [showGrantModal, setShowGrantModal] = useState(false);

  // Per-row permission patch state
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [provisioningIds, setProvisioningIds] = useState<Set<number>>(new Set());

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


  async function runBulkProvision(accountType: AccountType, label: string) {
    const product = accountType === 'workspace' ? 'League accounts' : 'Claude seats';
    if (!confirm(`Create ${product} for selected members?`)) return;
    setBusy(`provision-${accountType}`);
    setBanner(null);
    try {
      const body: any = { accountType };
      if (selectedIds.size > 0) {
        body.userIds = Array.from(selectedIds);
      }
      const res = await fetch(`/api/admin/groups/${id}/bulk-provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseBody = (await res.json().catch(() => ({}))) as BulkResult | { error?: string };
      if (!res.ok && res.status !== 207) {
        const msg = (responseBody as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const r = responseBody as BulkResult;
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

  async function runBulkLlmProxyGrant(expiresAtStr: string, tokenLimit: number) {
    setBusy('llm-proxy-grant');
    setBanner(null);
    setShowGrantModal(false);
    try {
      const body: any = { expiresAt: expiresAtStr, tokenLimit };
      if (selectedIds.size > 0) {
        body.userIds = Array.from(selectedIds);
      }
      const res = await fetch(
        `/api/admin/groups/${id}/llm-proxy/bulk-grant`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const responseBody = (await res.json().catch(() => ({}))) as any;
      if (!res.ok && res.status !== 207) {
        const msg = (responseBody as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const s = responseBody.succeeded?.length ?? 0;
      const f = responseBody.failed?.length ?? 0;
      const skip = responseBody.skipped?.length ?? 0;
      let csv = '';
      if (responseBody.tokensByUser) {
        csv = Object.entries(responseBody.tokensByUser)
          .map(([uid, tok]) => `${uid},${tok}`)
          .join('\n');
      }
      setBanner({
        ok: f === 0,
        msg:
          `LLM proxy grant: ${s} succeeded, ${f} failed, ${skip} skipped.` +
          (csv ? `\nTokens (user_id,token):\n${csv}` : ''),
      });
      await load();
    } catch (err: any) {
      setBanner({ ok: false, msg: err.message || 'LLM proxy grant failed' });
    } finally {
      setBusy(null);
    }
  }

  async function runBulkLlmProxyRevoke() {
    if (
      !confirm(
        'Revoke LLM proxy access for selected members who have active tokens?',
      )
    )
      return;
    setBusy('llm-proxy-revoke');
    setBanner(null);
    try {
      const body: any = {};
      if (selectedIds.size > 0) {
        body.userIds = Array.from(selectedIds);
      }
      const res = await fetch(
        `/api/admin/groups/${id}/llm-proxy/bulk-revoke`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const responseBody = (await res.json().catch(() => ({}))) as any;
      if (!res.ok && res.status !== 207) {
        const msg = (responseBody as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const s = responseBody.succeeded?.length ?? 0;
      const f = responseBody.failed?.length ?? 0;
      const skip = responseBody.skipped?.length ?? 0;
      setBanner({
        ok: f === 0,
        msg: `LLM proxy revoke: ${s} succeeded, ${f} failed, ${skip} skipped.`,
      });
      await load();
    } catch (err: any) {
      setBanner({ ok: false, msg: err.message || 'LLM proxy revoke failed' });
    } finally {
      setBusy(null);
    }
  }

  async function runBulkAll(op: 'suspend' | 'remove', label: string) {
    const verb = op === 'suspend' ? 'Suspend' : 'Delete';
    if (
      !confirm(
        `${verb} EVERY League and Claude account for selected members?`,
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
      const body: any = {};
      if (selectedIds.size > 0) {
        body.userIds = Array.from(selectedIds);
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseBody = (await res.json().catch(() => ({}))) as BulkResult | { error?: string };
      if (!res.ok && res.status !== 207) {
        const msg = (responseBody as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const r = responseBody as BulkResult;
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
    } catch (err: any) {
      setPermissionError(err.message || 'Permission update failed');
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

  // Ticket 007: Row selection helpers
  function toggleRowSelection(userId: number) {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedIds(newSelected);
  }

  function toggleSelectAll() {
    if (!data) return;
    if (selectedIds.size === data.users.length) {
      // All selected, deselect all
      setSelectedIds(new Set());
    } else {
      // Select all
      setSelectedIds(new Set(data.users.map((u) => u.id)));
    }
  }

  function isSelectAllIndeterminate() {
    if (!data || data.users.length === 0) return false;
    return selectedIds.size > 0 && selectedIds.size < data.users.length;
  }

  // Ticket 008: Compute effective target members for button counts
  function getEffectiveMembers(): Member[] {
    if (!data) return [];
    if (selectedIds.size > 0) {
      return data.users.filter((m) => selectedIds.has(m.id));
    }
    return data.users;
  }

  // Ticket 008: Button count computations
  function getCreateLeagueCount(): number {
    return getEffectiveMembers().filter(
      (m) => !m.externalAccounts.some((a) => a.type === 'workspace' && a.status === 'active'),
    ).length;
  }

  function getRemoveLeagueCount(): number {
    return getEffectiveMembers().filter(
      (m) => m.externalAccounts.some((a) => a.type === 'workspace' && a.status === 'active'),
    ).length;
  }

  function getSuspendCount(): number {
    // Count non-suspended members
    return getEffectiveMembers().filter(
      (m) => !m.externalAccounts.some((a) => a.status === 'suspended'),
    ).length;
  }

  function getGrantLlmProxyCount(): number {
    return getEffectiveMembers().filter(
      (m) => m.llmProxyToken.status !== 'active',
    ).length;
  }

  function getRevokeLlmProxyCount(): number {
    return getEffectiveMembers().filter(
      (m) => m.llmProxyToken.status === 'active',
    ).length;
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
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
          </div>
          <p style={{ color: '#64748b', marginTop: 0, fontSize: 13 }}>
            {data.group.description ? `${data.group.description} · ` : ''}
            {data.users.length} member{data.users.length === 1 ? '' : 's'}
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
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

      {/* Passphrase card */}
      {Number.isFinite(numericId) && (
        <PassphraseCard
          scopeKind="group"
          scopeId={numericId}
          scopeName={data.group.name}
        />
      )}

      {/* Bulk action buttons (Ticket 008) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <Button
          variant="default"
          disabled={busy !== null || getCreateLeagueCount() === 0}
          onClick={() => runBulkProvision('workspace', 'Create League accounts')}
        >
          Create League ({getCreateLeagueCount()})
        </Button>
        <Button
          variant="destructive"
          disabled={busy !== null || getRemoveLeagueCount() === 0}
          onClick={() => runBulkAll('remove', 'Delete all accounts')}
        >
          Remove League ({getRemoveLeagueCount()})
        </Button>
        <Button
          variant="outline"
          disabled={busy !== null || getSuspendCount() === 0}
          onClick={() => runBulkAll('suspend', 'Suspend all accounts')}
        >
          Suspend ({getSuspendCount()})
        </Button>
        <Button
          variant="default"
          disabled={busy !== null || getGrantLlmProxyCount() === 0}
          onClick={() => setShowGrantModal(true)}
        >
          Grant LLM Proxy ({getGrantLlmProxyCount()})
        </Button>
        {getRevokeLlmProxyCount() > 0 && (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={runBulkLlmProxyRevoke}
          >
            Revoke LLM Proxy ({getRevokeLlmProxyCount()})
          </Button>
        )}
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
            <th style={{ ...th, width: 40 }}>
              <input
                type="checkbox"
                checked={data.users.length > 0 && selectedIds.size === data.users.length}
                ref={(el) => {
                  if (el) {
                    el.indeterminate = isSelectAllIndeterminate();
                  }
                }}
                onChange={toggleSelectAll}
                aria-label="Select all members"
                style={{ cursor: 'pointer' }}
              />
            </th>
            <th style={th}>Name</th>
            <th style={th}>Email</th>
            <th style={{ ...th, textAlign: 'center' }}>OAuth</th>
            <th style={{ ...th, textAlign: 'center' }}>LLM Proxy</th>
            <th style={{ ...th, textAlign: 'center' }}>Lg Acct</th>
            <th style={{ ...th, width: 80, textAlign: 'center' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.users.map((m) => {
            return (
              <tr key={m.id}>
                <td style={{ ...td, width: 40 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(m.id)}
                    onChange={() => toggleRowSelection(m.id)}
                    aria-label={`Select ${m.displayName || m.email}`}
                    style={{ cursor: 'pointer' }}
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

      <LlmProxyGrantModal
        isOpen={showGrantModal}
        onCancel={() => setShowGrantModal(false)}
        onConfirm={runBulkLlmProxyGrant}
        isLoading={busy === 'llm-proxy-grant'}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents + styles
// ---------------------------------------------------------------------------

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
