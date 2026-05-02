/**
 * Groups — admin page for viewing and creating app-level Groups (Sprint 012).
 *
 * Mirrors Cohorts.tsx in shape: a sortable table powered by TanStack Query
 * with an inline create form at the top. Groups are the many-to-many
 * grouping layer that Sprint 012 introduces alongside the 1:1 Cohort.
 *
 * Data lifecycle:
 *   GET  /api/admin/groups           — list with member counts.
 *   POST /api/admin/groups           — create; invalidates the list query.
 *
 * Error handling:
 *   - Page-level loading / error state for the initial fetch.
 *   - Inline form error on create failure (409 duplicate, 422 blank).
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

type SortCol = 'name' | 'description' | 'memberCount' | 'createdAt';

interface Group {
  id: number;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchGroups(): Promise<Group[]> {
  const res = await fetch('/api/admin/groups');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function createGroup(input: { name: string; description?: string }): Promise<Group> {
  const res = await fetch('/api/admin/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Groups component
// ---------------------------------------------------------------------------

export default function Groups() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const { data: groups, isLoading, error } = useQuery<Group[], Error>({
    queryKey: ['admin', 'groups'],
    queryFn: fetchGroups,
  });

  const createMutation = useMutation<
    Group,
    Error,
    { name: string; description?: string }
  >({
    mutationFn: createGroup,
    onSuccess: () => {
      setNewName('');
      setNewDesc('');
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
    },
    onError: (err) => setFormError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmed = newName.trim();
    if (!trimmed) {
      setFormError('Group name must not be blank.');
      return;
    }
    createMutation.mutate({
      name: trimmed,
      description: newDesc.trim() || undefined,
    });
  }

  if (isLoading) return <p style={loadingStyle}>Loading groups…</p>;
  if (error) return <p style={errorStyle}>Failed to load groups: {error.message}</p>;

  return (
    <div>
      <h2 style={headingStyle}>Groups</h2>

      <form onSubmit={handleSubmit} style={formStyle}>
        <input
          type="text"
          placeholder="New group name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={inputStyle}
          aria-label="New group name"
          disabled={createMutation.isPending}
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          style={{ ...inputStyle, minWidth: 280 }}
          aria-label="New group description"
          disabled={createMutation.isPending}
        />
        <button
          type="submit"
          style={submitButtonStyle}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? 'Creating…' : 'Create Group'}
        </button>
        {formError && (
          <span style={inlineErrorStyle} role="alert">
            {formError}
          </span>
        )}
      </form>

      <input
        type="search"
        placeholder="Search groups…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={searchInputStyle}
        aria-label="Search groups"
      />

      {groups && groups.length === 0 ? (
        <p style={emptyStyle}>No groups yet.</p>
      ) : (
        <GroupsTable
          groups={groups ?? []}
          search={search}
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={(col) => {
            if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
            else { setSortCol(col); setSortDir('asc'); }
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

interface GroupsTableProps {
  groups: Group[];
  search: string;
  sortCol: SortCol;
  sortDir: 'asc' | 'desc';
  onSort: (col: SortCol) => void;
}

function GroupsTable({ groups, search, sortCol, sortDir, onSort }: GroupsTableProps) {
  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? groups.filter(
          (g) =>
            g.name.toLowerCase().includes(q) ||
            (g.description ?? '').toLowerCase().includes(q),
        )
      : groups;
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'description':
          cmp = (a.description ?? '').localeCompare(b.description ?? '');
          break;
        case 'memberCount':
          cmp = a.memberCount - b.memberCount;
          break;
        case 'createdAt':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [groups, search, sortCol, sortDir]);

  const arrow = (col: SortCol) => (col === sortCol ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const thProps = (_col: SortCol): React.CSSProperties => ({
    ...thStyle,
    cursor: 'pointer',
    userSelect: 'none',
  });

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thProps('name')} onClick={() => onSort('name')}>
            Name{arrow('name')}
          </th>
          <th style={thProps('description')} onClick={() => onSort('description')}>
            Description{arrow('description')}
          </th>
          <th style={thProps('memberCount')} onClick={() => onSort('memberCount')}>
            Members{arrow('memberCount')}
          </th>
          <th style={thProps('createdAt')} onClick={() => onSort('createdAt')}>
            Created On{arrow('createdAt')}
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((g) => (
          <tr key={g.id}>
            <td style={tdStyle}>
              <Link
                to={`/groups/${g.id}`}
                style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}
              >
                {g.name}
              </Link>
            </td>
            <td style={tdStyle}>{g.description ?? '-'}</td>
            <td style={tdStyle}>{g.memberCount}</td>
            <td style={tdStyle}>{new Date(g.createdAt).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Styles (deliberately kept symmetrical with Cohorts.tsx)
// ---------------------------------------------------------------------------

const headingStyle: React.CSSProperties = { margin: '0 0 16px', fontSize: 20 };
const loadingStyle: React.CSSProperties = { color: '#64748b' };
const errorStyle: React.CSSProperties = { color: '#dc2626' };
const emptyStyle: React.CSSProperties = {
  color: '#94a3b8',
  textAlign: 'center',
  marginTop: 24,
};
const formStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
  marginBottom: 24,
};
const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 14,
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  minWidth: 240,
};
const submitButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 14,
  background: '#4f46e5',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};
const inlineErrorStyle: React.CSSProperties = { color: '#dc2626', fontSize: 13 };
const searchInputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 14,
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  minWidth: 260,
  marginBottom: 16,
  display: 'block',
};
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
};
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid #e2e8f0',
  fontWeight: 600,
  fontSize: 13,
  color: '#64748b',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'top',
};
