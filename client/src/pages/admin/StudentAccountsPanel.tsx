/**
 * StudentAccountsPanel — /users/students.
 *
 * Read-only student-account view. Lists every active user whose primary
 * email is on the student domain. Supports bulk suspend of their
 * workspace + claude accounts by selecting rows and clicking
 * "Suspend accounts".
 *
 * Includes a search bar (filter by name or email, client-side) and
 * sortable column headers for Name, Email, Cohort, Accounts, and Joined.
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

type SortCol = 'name' | 'email' | 'cohort' | 'accounts' | 'joined';

function normalizeRole(role: string): 'admin' | 'staff' | 'student' {
  const r = role.toLowerCase();
  if (r === 'admin') return 'admin';
  if (r === 'staff') return 'staff';
  return 'student';
}

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

// ---------------------------------------------------------------------------
// Search + sort helpers
// ---------------------------------------------------------------------------

function applySearch(users: AdminUser[], search: string): AdminUser[] {
  const q = search.trim().toLowerCase();
  if (!q) return users;
  return users.filter(
    (u) =>
      (u.displayName ?? '').toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q),
  );
}

function accountsSortKey(u: AdminUser): string {
  const types = u.externalAccounts?.map((a) => a.type) ?? u.externalAccountTypes ?? [];
  const unique = Array.from(new Set(types)).sort();
  return `${String(9 - unique.length).padStart(2, '0')}-${unique.join(',')}`;
}

function sortStudents(users: AdminUser[], col: SortCol, dir: 'asc' | 'desc'): AdminUser[] {
  const sorted = [...users].sort((a, b) => {
    let cmp = 0;
    switch (col) {
      case 'name':
        cmp = (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email);
        break;
      case 'email':
        cmp = a.email.localeCompare(b.email);
        break;
      case 'cohort':
        cmp = (a.cohort?.name ?? '').localeCompare(b.cohort?.name ?? '');
        break;
      case 'accounts':
        cmp = accountsSortKey(a).localeCompare(accountsSortKey(b));
        break;
      case 'joined':
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

// ---------------------------------------------------------------------------
// Sortable column header
// ---------------------------------------------------------------------------

interface SortableThProps {
  col: SortCol;
  activeCol: SortCol;
  dir: 'asc' | 'desc';
  onSort: (col: SortCol) => void;
  children: React.ReactNode;
}

function SortableTh({ col, activeCol, dir, onSort, children }: SortableThProps) {
  const active = col === activeCol;
  return (
    <th
      style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onSort(col)}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {children}
      {active && (
        <span style={{ marginLeft: 4, fontSize: 10 }}>{dir === 'asc' ? '▲' : '▼'}</span>
      )}
    </th>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function StudentAccountsPanel() {
  const queryClient = useQueryClient();
  const { data: users, isLoading, error } = useQuery<AdminUser[], Error>({
    queryKey: ['admin', 'users'],
    queryFn: fetchUsers,
  });

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);

  // Search + sort state. Default: newest-first (joined desc).
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('joined');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

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

  // Filter to students, apply search, then sort.
  const visibleStudents = useMemo(() => {
    const students = (users ?? []).filter((u) => normalizeRole(u.role) === 'student');
    const searched = applySearch(students, search);
    return sortStudents(searched, sortCol, sortDir);
  }, [users, search, sortCol, sortDir]);

  function handleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  // Total count of students (before search filter, for the subtitle).
  const totalStudents = useMemo(
    () => (users ?? []).filter((u) => normalizeRole(u.role) === 'student').length,
    [users],
  );

  const allSelected =
    visibleStudents.length > 0 && visibleStudents.every((u) => selected.has(u.id));
  const someSelected = visibleStudents.some((u) => selected.has(u.id));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleStudents.map((u) => u.id)));
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

      {/* Toolbar: suspend button + count + search */}
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleSuspend}
          disabled={selected.size === 0 || suspendMutation.isPending}
          style={bulkButtonStyle(selected.size === 0 || suspendMutation.isPending)}
        >
          {suspendMutation.isPending ? 'Suspending…' : `Suspend accounts (${selected.size})`}
        </button>
        <span style={{ fontSize: 13, color: '#64748b' }}>
          {totalStudents} student{totalStudents === 1 ? '' : 's'}
        </span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          aria-label="Search students"
          style={searchInputStyle}
        />
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
                disabled={visibleStudents.length === 0}
              />
            </th>
            <SortableTh col="name" activeCol={sortCol} dir={sortDir} onSort={handleSort}>
              Name
            </SortableTh>
            <SortableTh col="email" activeCol={sortCol} dir={sortDir} onSort={handleSort}>
              Email
            </SortableTh>
            <SortableTh col="cohort" activeCol={sortCol} dir={sortDir} onSort={handleSort}>
              Cohort
            </SortableTh>
            <SortableTh col="accounts" activeCol={sortCol} dir={sortDir} onSort={handleSort}>
              Accounts
            </SortableTh>
            <SortableTh col="joined" activeCol={sortCol} dir={sortDir} onSort={handleSort}>
              Joined
            </SortableTh>
          </tr>
        </thead>
        <tbody>
          {visibleStudents.map((u) => {
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
          {visibleStudents.length === 0 && (
            <tr>
              <td colSpan={6} style={{ ...td, color: '#94a3b8', textAlign: 'center' }}>
                {search ? 'No students match your search.' : 'No students yet.'}
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

const searchInputStyle: React.CSSProperties = {
  flex: '1 1 auto',
  maxWidth: 320,
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  outline: 'none',
};

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
