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

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [createOpen, setCreateOpen] = useState(false);

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
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
      setCreateOpen(false);
      navigate(`/groups/${group.id}`);
    },
  });

  if (isLoading) return <p style={loadingStyle}>Loading groups…</p>;
  if (error) return <p style={errorStyle}>Failed to load groups: {error.message}</p>;

  return (
    <div>
      <div style={titleRowStyle}>
        <h2 style={{ ...headingStyle, marginBottom: 0 }}>Groups</h2>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          style={newButtonStyle}
          aria-label="New group"
        >
          New +
        </button>
      </div>

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

      {createOpen && (
        <NewGroupDialog
          onCancel={() => {
            setCreateOpen(false);
            createMutation.reset();
          }}
          onSubmit={(name, description) =>
            createMutation.mutate({ name, description: description || undefined })
          }
          submitting={createMutation.isPending}
          error={createMutation.error?.message ?? null}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New group dialog (modal with name + description; closes on ESC)
// ---------------------------------------------------------------------------

interface NewGroupDialogProps {
  onCancel: () => void;
  onSubmit: (name: string, description: string) => void;
  submitting: boolean;
  error: string | null;
}

function NewGroupDialog({ onCancel, onSubmit, submitting, error }: NewGroupDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, submitting]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError('Group name must not be blank.');
      return;
    }
    setLocalError(null);
    onSubmit(trimmed, description.trim());
  }

  const shownError = localError ?? error;

  return (
    <div
      style={overlayStyle}
      onClick={() => {
        if (!submitting) onCancel();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-group-title"
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="new-group-title" style={dialogTitleStyle}>New group</h3>
        <form onSubmit={handleSubmit} style={dialogFormStyle}>
          <label style={dialogLabelStyle}>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              autoFocus
              disabled={submitting}
              aria-label="Group name"
            />
          </label>
          <label style={dialogLabelStyle}>
            Description (optional)
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={inputStyle}
              disabled={submitting}
              aria-label="Group description"
            />
          </label>
          {shownError && (
            <p style={inlineErrorStyle} role="alert">{shownError}</p>
          )}
          <div style={dialogActionsStyle}>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              style={cancelButtonStyle}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={submitButtonStyle}
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
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
const titleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 16,
};
const newButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 13,
  background: '#4f46e5',
  color: '#fff',
  border: 'none',
  borderRadius: 999,
  cursor: 'pointer',
  fontWeight: 600,
};
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const dialogStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: '20px 24px',
  minWidth: 360,
  maxWidth: 520,
  boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)',
};
const dialogTitleStyle: React.CSSProperties = { margin: '0 0 16px', fontSize: 18 };
const dialogFormStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
const dialogLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  color: '#475569',
};
const dialogActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 4,
};
const cancelButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 14,
  background: '#fff',
  color: '#1e293b',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};
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
