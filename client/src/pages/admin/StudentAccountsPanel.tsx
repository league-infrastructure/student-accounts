/**
 * StudentAccountsPanel — /users/students.
 *
 * Read-only student-account view. Lists every active user whose primary
 * email is on the student domain. Supports bulk suspend of their
 * workspace + claude accounts by selecting rows and clicking
 * "Suspend accounts".
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isRecent, NEW_USER_BG } from '../../lib/recent-user';

interface UserExternalAccount {
  type: string;
  status: string;
  externalId: string | null;
}

interface AdminUser {
  id: number;
  email: string;
  displayName: string | null;
  role: string;
  cohort: { id: number; name: string } | null;
  externalAccounts?: UserExternalAccount[];
  externalAccountTypes?: string[];
  createdAt: string;
}

interface BulkSuspendResult {
  succeeded: number[];
  failed: Array<{ accountId: number; userId: number; type: string; error: string }>;
  totalEligible: number;
}

const STUDENT_EMAIL_RE = /@students\.[a-z0-9.-]+$/i;

function fetchUsers(): Promise<AdminUser[]> {
  return fetch('/api/admin/users')
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
}

async function bulkSuspendAccounts(userIds: number[]): Promise<BulkSuspendResult> {
  const res = await fetch('/api/admin/users/bulk-suspend-accounts', {
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

export default function StudentAccountsPanel() {
  const queryClient = useQueryClient();
  const { data: users, isLoading, error } = useQuery<AdminUser[], Error>({
    queryKey: ['admin', 'users'],
    queryFn: fetchUsers,
  });

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);

  const suspendMutation = useMutation<BulkSuspendResult, Error, number[]>({
    mutationFn: bulkSuspendAccounts,
    onSuccess: (result) => {
      const s = result.succeeded.length;
      const f = result.failed.length;
      setBanner({
        ok: f === 0,
        msg:
          `Suspend accounts: ${s} succeeded, ${f} failed` +
          (f > 0
            ? ` — ${result.failed.map((x) => `user ${x.userId} (${x.type}): ${x.error}`).join('; ')}`
            : '.'),
      });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => setBanner({ ok: false, msg: err.message }),
  });

  // Newest students first — admins usually want to see the latest
  // arrivals immediately. Rows inside the 24h window also get the
  // `NEW_USER_BG` background.
  const studentUsers = useMemo(() => {
    const filtered = (users ?? []).filter((u) => STUDENT_EMAIL_RE.test(u.email));
    return [...filtered].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [users]);

  const allSelected =
    studentUsers.length > 0 && studentUsers.every((u) => selected.has(u.id));
  const someSelected = studentUsers.some((u) => selected.has(u.id));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(studentUsers.map((u) => u.id)));
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

  function handleSuspend() {
    if (selected.size === 0) return;
    if (!confirm(`Suspend every active workspace + Claude account for ${selected.size} user${selected.size === 1 ? '' : 's'}?`)) return;
    suspendMutation.mutate([...selected]);
  }

  if (isLoading) return <p style={{ color: '#64748b' }}>Loading students…</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error.message}</p>;

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>League Students</h2>
      <p style={{ color: '#64748b', marginTop: 0, fontSize: 13 }}>
        Active users with a @students.jointheleague.org account — i.e. students
        who have a League workspace identity, not just a username/passphrase
        account. Use the checkboxes to select rows and run a bulk action.
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
          onClick={handleSuspend}
          disabled={selected.size === 0 || suspendMutation.isPending}
          style={bulkButtonStyle(selected.size === 0 || suspendMutation.isPending)}
        >
          {suspendMutation.isPending ? 'Suspending…' : `Suspend accounts (${selected.size})`}
        </button>
        <span style={{ fontSize: 13, color: '#64748b' }}>
          {studentUsers.length} student{studentUsers.length === 1 ? '' : 's'}
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
                disabled={studentUsers.length === 0}
              />
            </th>
            <th style={th}>Name</th>
            <th style={th}>Email</th>
            <th style={th}>Cohort</th>
            <th style={th}>Accounts</th>
            <th style={th}>Joined</th>
          </tr>
        </thead>
        <tbody>
          {studentUsers.map((u) => {
            const highlight = isRecent(u.createdAt);
            return (
              <tr
                key={u.id}
                style={highlight ? { background: NEW_USER_BG } : undefined}
              >
                <td style={td}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${u.displayName ?? u.email}`}
                    checked={selected.has(u.id)}
                    onChange={() => toggleOne(u.id)}
                  />
                </td>
                <td style={td}>
                  <Link to={`/users/${u.id}`} style={linkStyle}>
                    {u.displayName || u.email}
                  </Link>
                </td>
                <td style={td}>{u.email}</td>
                <td style={td}>{u.cohort?.name ?? <em style={{ color: '#94a3b8' }}>none</em>}</td>
                <td style={td}>{summarizeAccounts(u)}</td>
                <td style={td}>{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            );
          })}
          {studentUsers.length === 0 && (
            <tr>
              <td colSpan={6} style={{ ...td, color: '#94a3b8', textAlign: 'center' }}>
                No students yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function summarizeAccounts(u: AdminUser): React.ReactNode {
  const types = u.externalAccounts?.map((a) => a.type) ?? u.externalAccountTypes ?? [];
  if (types.length === 0) return <em style={{ color: '#94a3b8' }}>none</em>;
  return Array.from(new Set(types)).sort().join(', ');
}

function bulkButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    background: disabled ? '#cbd5e1' : '#d97706',
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
