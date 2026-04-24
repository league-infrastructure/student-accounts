/**
 * LlmProxyUsersPanel — /users/llm-proxy.
 *
 * Lists every active user who currently holds an active LLM proxy
 * token. Supports bulk revoke by selecting rows and clicking
 * "Revoke tokens".
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface LlmProxyUserRow {
  userId: number;
  displayName: string | null;
  email: string;
  role: string;
  cohort: { id: number; name: string } | null;
  tokenId: number;
  tokensUsed: number;
  tokenLimit: number;
  requestCount: number;
  expiresAt: string;
  grantedAt: string;
}

interface BulkRevokeResult {
  succeeded: number[];
  failed: Array<{ userId: number; error: string }>;
  skipped: number[];
}

async function fetchLlmProxyUsers(): Promise<LlmProxyUserRow[]> {
  const res = await fetch('/api/admin/users/with-llm-proxy');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function bulkRevoke(userIds: number[]): Promise<BulkRevokeResult> {
  const res = await fetch('/api/admin/users/bulk-revoke-llm-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds }),
  });
  if (!res.ok && res.status !== 207) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export default function LlmProxyUsersPanel() {
  const queryClient = useQueryClient();
  const { data: rows, isLoading, error } = useQuery<LlmProxyUserRow[], Error>({
    queryKey: ['admin', 'users', 'with-llm-proxy'],
    queryFn: fetchLlmProxyUsers,
  });

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);

  const revokeMutation = useMutation<BulkRevokeResult, Error, number[]>({
    mutationFn: bulkRevoke,
    onSuccess: (result) => {
      const s = result.succeeded.length;
      const f = result.failed.length;
      const sk = result.skipped.length;
      setBanner({
        ok: f === 0,
        msg:
          `Revoke tokens: ${s} succeeded, ${f} failed, ${sk} skipped` +
          (f > 0 ? ` — ${result.failed.map((x) => `user ${x.userId}: ${x.error}`).join('; ')}` : '.'),
      });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', 'with-llm-proxy'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => setBanner({ ok: false, msg: err.message }),
  });

  const visible = rows ?? [];
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.userId));
  const someSelected = visible.some((r) => selected.has(r.userId));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((r) => r.userId)));
    }
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleRevoke() {
    if (selected.size === 0) return;
    if (!confirm(`Revoke LLM proxy tokens for ${selected.size} user${selected.size === 1 ? '' : 's'}? Their current tokens will stop working immediately.`)) return;
    revokeMutation.mutate([...selected]);
  }

  if (isLoading) return <p style={{ color: '#64748b' }}>Loading LLM proxy users…</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error.message}</p>;

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>LLM proxy users</h2>
      <p style={{ color: '#64748b', marginTop: 0, fontSize: 13 }}>
        Every active user with a currently-active LLM proxy token. Select
        rows to bulk-revoke.
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

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={handleRevoke}
          disabled={selected.size === 0 || revokeMutation.isPending}
          style={bulkButtonStyle(selected.size === 0 || revokeMutation.isPending)}
        >
          {revokeMutation.isPending ? 'Revoking…' : `Revoke tokens (${selected.size})`}
        </button>
        <span style={{ fontSize: 13, color: '#64748b' }}>
          {visible.length} user{visible.length === 1 ? '' : 's'} with an active token
        </span>
      </div>

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ ...th, width: 36 }}>
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allSelected && someSelected;
                }}
                onChange={toggleAll}
                disabled={visible.length === 0}
              />
            </th>
            <th style={th}>Name</th>
            <th style={th}>Email</th>
            <th style={th}>Cohort</th>
            <th style={th}>Usage</th>
            <th style={th}>Expires</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const pct = r.tokenLimit > 0 ? Math.min(100, Math.round((r.tokensUsed / r.tokenLimit) * 100)) : 0;
            return (
              <tr key={r.userId}>
                <td style={td}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.displayName ?? r.email}`}
                    checked={selected.has(r.userId)}
                    onChange={() => toggleOne(r.userId)}
                  />
                </td>
                <td style={td}>
                  <Link to={`/users/${r.userId}`} style={linkStyle}>
                    {r.displayName || r.email}
                  </Link>
                </td>
                <td style={td}>{r.email}</td>
                <td style={td}>{r.cohort?.name ?? <em style={{ color: '#94a3b8' }}>none</em>}</td>
                <td style={td}>
                  {r.tokensUsed.toLocaleString()} / {r.tokenLimit.toLocaleString()}{' '}
                  <span style={{ color: '#64748b', fontSize: 12 }}>({pct}%)</span>
                </td>
                <td style={td}>{new Date(r.expiresAt).toLocaleDateString()}</td>
              </tr>
            );
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={6} style={{ ...td, color: '#94a3b8', textAlign: 'center' }}>
                No users have an active LLM proxy token.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function bulkButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    background: disabled ? '#cbd5e1' : '#dc2626',
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
const linkStyle: React.CSSProperties = {
  color: '#2563eb',
  textDecoration: 'none',
  fontWeight: 600,
};
