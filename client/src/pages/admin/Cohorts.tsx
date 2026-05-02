/**
 * Cohorts — admin page for viewing and creating cohorts.
 *
 * Cohorts are the Google Workspace Organizational Unit concept. Account
 * management (workspace, Claude, LLM proxy) does NOT happen here — it
 * happens on the corresponding Group detail page. The "Sync to group"
 * button on each row creates (or finds) a group with the cohort's name
 * and copies every active student into it.
 *
 * Error handling:
 *  - Page-level loading/error state for the initial fetch.
 *  - Inline form error on create failure (e.g. duplicate name → 409).
 *  - On success: query is invalidated so the list refreshes.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

type SortCol = 'name' | 'google_ou_path' | 'createdAt';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Cohort {
  id: number;
  name: string;
  google_ou_path: string | null;
  createdAt: string;
  memberCount: number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchCohorts(): Promise<Cohort[]> {
  const res = await fetch('/api/admin/cohorts');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function createCohort(name: string): Promise<Cohort> {
  const res = await fetch('/api/admin/cohorts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

interface SyncToGroupResult {
  groupId: number;
  groupName: string;
  created: boolean;
  addedCount: number;
  alreadyMemberCount: number;
  eligibleCount: number;
}

async function syncCohortToGroup(cohortId: number): Promise<SyncToGroupResult> {
  const res = await fetch(`/api/admin/cohorts/${cohortId}/sync-to-group`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Cohorts component
// ---------------------------------------------------------------------------

export default function Cohorts() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [syncBanner, setSyncBanner] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  const { data: cohorts, isLoading, error } = useQuery<Cohort[], Error>({
    queryKey: ['admin', 'cohorts'],
    queryFn: fetchCohorts,
  });

  const createMutation = useMutation<Cohort, Error, string>({
    mutationFn: createCohort,
    onSuccess: () => {
      setNewName('');
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'cohorts'] });
    },
    onError: (err) => {
      setFormError(err.message);
    },
  });

  const syncMutation = useMutation<SyncToGroupResult, Error, Cohort>({
    mutationFn: (cohort) => syncCohortToGroup(cohort.id),
    onSuccess: (result, cohort) => {
      const verb = result.created ? 'Created group' : 'Updated group';
      setSyncBanner({
        ok: true,
        msg: `${verb} "${result.groupName}" from cohort "${cohort.name}": added ${result.addedCount}, already a member: ${result.alreadyMemberCount}.`,
      });
      queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
      navigate(`/groups/${result.groupId}`);
    },
    onError: (err) => {
      setSyncBanner({ ok: false, msg: err.message });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmed = newName.trim();
    if (!trimmed) {
      setFormError('Cohort name must not be blank.');
      return;
    }
    createMutation.mutate(trimmed);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (isLoading) {
    return <p style={loadingStyle}>Loading cohorts...</p>;
  }

  if (error) {
    return (
      <p style={errorStyle}>
        Failed to load cohorts: {error.message}
      </p>
    );
  }

  return (
    <div>
      <h2 style={headingStyle}>Cohorts</h2>

      {/* Create form */}
      <form onSubmit={handleSubmit} style={formStyle}>
        <input
          type="text"
          placeholder="New cohort name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={inputStyle}
          aria-label="New cohort name"
          disabled={createMutation.isPending}
        />
        <button
          type="submit"
          style={submitButtonStyle}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? 'Creating...' : 'Create Cohort'}
        </button>
        {formError && (
          <span style={inlineErrorStyle} role="alert">
            {formError}
          </span>
        )}
      </form>

      {syncBanner && (
        <div
          role={syncBanner.ok ? 'status' : 'alert'}
          style={syncBanner.ok ? bannerOkStyle : bannerErrorStyle}
        >
          {syncBanner.msg}
        </div>
      )}

      {/* Search bar */}
      <div style={searchBarStyle}>
        <input
          type="search"
          placeholder="Search cohorts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={inputStyle}
          aria-label="Search cohorts"
        />
      </div>

      {/* Cohort list */}
      {cohorts && cohorts.length === 0 ? (
        <p style={emptyStyle}>No cohorts yet.</p>
      ) : (
        <CohortsTable
          cohorts={cohorts ?? []}
          search={search}
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={(col) => {
            if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
            else { setSortCol(col); setSortDir('asc'); }
          }}
          onSyncToGroup={(cohort) => syncMutation.mutate(cohort)}
          syncingId={syncMutation.isPending ? syncMutation.variables?.id ?? null : null}
        />
      )}

    </div>
  );
}

// ---------------------------------------------------------------------------
// CohortsTable — sortable table; cohort names link to /cohorts/:id
// ---------------------------------------------------------------------------

interface CohortsTableProps {
  cohorts: Cohort[];
  search: string;
  sortCol: SortCol;
  sortDir: 'asc' | 'desc';
  onSort: (col: SortCol) => void;
  onSyncToGroup: (cohort: Cohort) => void;
  syncingId: number | null;
}

function CohortsTable({
  cohorts,
  search,
  sortCol,
  sortDir,
  onSort,
  onSyncToGroup,
  syncingId,
}: CohortsTableProps) {
  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? cohorts.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.google_ou_path ?? '').toLowerCase().includes(q),
        )
      : cohorts;
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'google_ou_path':
          cmp = (a.google_ou_path ?? '').localeCompare(b.google_ou_path ?? '');
          break;
        case 'createdAt':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [cohorts, search, sortCol, sortDir]);

  const arrow = (col: SortCol) => (col === sortCol ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const thProps = (col: SortCol): React.CSSProperties => ({
    ...thStyle,
    cursor: 'pointer',
    userSelect: 'none',
  });

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thProps('name')} onClick={() => onSort('name')}>Name{arrow('name')}</th>
          <th style={thStyle}>Students</th>
          <th style={thProps('google_ou_path')} onClick={() => onSort('google_ou_path')}>
            Google OU Path{arrow('google_ou_path')}
          </th>
          <th style={thProps('createdAt')} onClick={() => onSort('createdAt')}>
            Created On{arrow('createdAt')}
          </th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((cohort) => {
          const isSyncing = syncingId === cohort.id;
          return (
            <tr key={cohort.id}>
              <td style={tdStyle}>
                <Link to={`/cohorts/${cohort.id}`} style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
                  {cohort.name}
                </Link>
              </td>
              <td style={tdStyle}>{cohort.memberCount}</td>
              <td style={tdStyle}>{cohort.google_ou_path ?? '-'}</td>
              <td style={tdStyle}>{new Date(cohort.createdAt).toLocaleDateString()}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                <button
                  type="button"
                  onClick={() => onSyncToGroup(cohort)}
                  disabled={isSyncing || cohort.memberCount === 0}
                  style={syncButtonStyle(isSyncing || cohort.memberCount === 0)}
                  title={
                    cohort.memberCount === 0
                      ? 'Cohort has no students yet'
                      : `Create or update a group named "${cohort.name}" with every active student in this cohort`
                  }
                >
                  {isSyncing ? 'Syncing…' : 'Sync to group'}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const headingStyle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: 20,
};

const loadingStyle: React.CSSProperties = {
  color: '#64748b',
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
};

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

const inlineErrorStyle: React.CSSProperties = {
  color: '#dc2626',
  fontSize: 13,
};

const searchBarStyle: React.CSSProperties = {
  marginBottom: 16,
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

function syncButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 12px',
    fontSize: 13,
    background: disabled ? '#cbd5e1' : '#0891b2',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
  };
}

const bannerOkStyle: React.CSSProperties = {
  padding: '10px 12px',
  marginBottom: 16,
  background: '#ecfdf5',
  color: '#065f46',
  border: '1px solid #a7f3d0',
  borderRadius: 6,
  fontSize: 13,
};

const bannerErrorStyle: React.CSSProperties = {
  padding: '10px 12px',
  marginBottom: 16,
  background: '#fef2f2',
  color: '#991b1b',
  border: '1px solid #fecaca',
  borderRadius: 6,
  fontSize: 13,
};
