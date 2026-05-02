import { useEffect, useMemo, useState } from 'react';
import { prettifyName } from '../admin/utils/prettifyName';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface Cohort {
  id: number;
  name: string;
}

interface DirectoryStudent {
  id: number;
  displayName: string | null;
  email: string;
  createdAt: string;
  cohort: Cohort | null;
  externalAccountTypes: string[];
}

/* ------------------------------------------------------------------ */
/*  Sorting                                                             */
/* ------------------------------------------------------------------ */

type SortCol = 'name' | 'email' | 'cohort' | 'accounts' | 'joined';

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
      style={{
        padding: '8px 12px',
        textAlign: 'left',
        fontWeight: 600,
        color: '#374151',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        userSelect: 'none',
      }}
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

function sortStudents(students: DirectoryStudent[], col: SortCol, dir: 'asc' | 'desc'): DirectoryStudent[] {
  const sorted = [...students].sort((a, b) => {
    let cmp = 0;
    switch (col) {
      case 'name':
        cmp = prettifyName({ displayName: a.displayName, email: a.email })
          .localeCompare(prettifyName({ displayName: b.displayName, email: b.email }));
        break;
      case 'email':
        cmp = a.email.localeCompare(b.email);
        break;
      case 'cohort':
        cmp = (a.cohort?.name ?? '').localeCompare(b.cohort?.name ?? '');
        break;
      case 'accounts':
        cmp = a.externalAccountTypes.slice().sort().join(',')
          .localeCompare(b.externalAccountTypes.slice().sort().join(','));
        break;
      case 'joined':
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const ACCOUNT_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  workspace: { label: 'Workspace', color: '#166534', bg: '#dcfce7' },
  claude:    { label: 'Claude',    color: '#1e40af', bg: '#dbeafe' },
  pike13:    { label: 'Pike13',    color: '#7c3aed', bg: '#ede9fe' },
};

const FILTER_TYPES = ['workspace', 'claude', 'pike13'] as const;
type FilterType = (typeof FILTER_TYPES)[number];

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function AccountBadge({ type }: { type: string }) {
  const style = ACCOUNT_BADGES[type] ?? {
    label: type,
    color: '#374151',
    bg: '#f3f4f6',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 600,
        color: style.color,
        background: style.bg,
        marginRight: 4,
      }}
    >
      {style.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Read-only detail view                                               */
/* ------------------------------------------------------------------ */

function StudentDetail({ student, onClose }: { student: DirectoryStudent; onClose: () => void }) {
  return (
    <div
      style={{
        marginTop: 0,
        marginBottom: 16,
        padding: 16,
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {prettifyName({ displayName: student.displayName, email: student.email })}
        </h3>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 18,
            cursor: 'pointer',
            color: '#6b7280',
            padding: '0 4px',
          }}
          aria-label="Close"
        >
          &times;
        </button>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 8, columnGap: 16, margin: 0, fontSize: 14 }}>
        <dt style={{ color: '#6b7280', fontWeight: 500 }}>Email</dt>
        <dd style={{ margin: 0 }}>{student.email}</dd>
        <dt style={{ color: '#6b7280', fontWeight: 500 }}>Cohort</dt>
        <dd style={{ margin: 0 }}>{student.cohort?.name ?? '—'}</dd>
        <dt style={{ color: '#6b7280', fontWeight: 500 }}>Accounts</dt>
        <dd style={{ margin: 0 }}>
          {student.externalAccountTypes.length === 0
            ? <span style={{ color: '#9ca3af' }}>None</span>
            : student.externalAccountTypes.map((t) => <AccountBadge key={t} type={t} />)}
        </dd>
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                           */
/* ------------------------------------------------------------------ */

export default function StaffDirectory() {
  const [students, setStudents] = useState<DirectoryStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cohortFilter, setCohortFilter] = useState<string>('');
  const [accountFilter, setAccountFilter] = useState<FilterType | ''>('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function handleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setSelectedId(null);
  }

  useEffect(() => {
    fetch('/api/staff/directory')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DirectoryStudent[]>;
      })
      .then((data) => setStudents(data))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load directory'),
      )
      .finally(() => setLoading(false));
  }, []);

  /* -------- Derived data -------- */

  const allCohorts = Array.from(
    new Map(
      students
        .filter((s) => s.cohort)
        .map((s) => [s.cohort!.id, s.cohort!]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const filtered = useMemo(() => {
    const base = students.filter((s) => {
      const name = prettifyName({ displayName: s.displayName, email: s.email }).toLowerCase();
      const q = search.toLowerCase();
      if (q && !name.includes(q) && !s.email.toLowerCase().includes(q)) return false;
      if (cohortFilter && String(s.cohort?.id ?? '') !== cohortFilter) return false;
      if (accountFilter && !s.externalAccountTypes.includes(accountFilter)) return false;
      return true;
    });
    return sortStudents(base, sortCol, sortDir);
  }, [students, search, cohortFilter, accountFilter, sortCol, sortDir]);

  const selectedStudent = selectedId !== null
    ? students.find((s) => s.id === selectedId) ?? null
    : null;

  /* -------- Render -------- */

  if (loading) {
    return <p style={{ padding: 24 }}>Loading directory...</p>;
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: '#dc2626' }}>
        <strong>Error loading directory:</strong> {error}
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginTop: 0, marginBottom: 20, fontSize: 22, fontWeight: 700 }}>
        Student Directory
      </h1>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Search name or email..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelectedId(null); }}
          style={{
            padding: '7px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 14,
            minWidth: 220,
          }}
          aria-label="Search students"
        />
        <select
          value={cohortFilter}
          onChange={(e) => { setCohortFilter(e.target.value); setSelectedId(null); }}
          style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
          aria-label="Filter by cohort"
        >
          <option value="">All Cohorts</option>
          {allCohorts.map((c) => (
            <option key={c.id} value={String(c.id)}>{c.name}</option>
          ))}
        </select>
        <select
          value={accountFilter}
          onChange={(e) => { setAccountFilter(e.target.value as FilterType | ''); setSelectedId(null); }}
          style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
          aria-label="Filter by account type"
        >
          <option value="">All Account Types</option>
          {FILTER_TYPES.map((t) => (
            <option key={t} value={t}>{ACCOUNT_BADGES[t]?.label ?? t}</option>
          ))}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>
          {filtered.length} {filtered.length === 1 ? 'student' : 'students'}
        </span>
      </div>

      {/* Detail panel (inline, above table) */}
      {selectedStudent && (
        <StudentDetail
          student={selectedStudent}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 14 }}>No students match this filter.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 14,
            }}
          >
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
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
              {filtered.map((student) => {
                const isSelected = student.id === selectedId;
                return (
                  <tr
                    key={student.id}
                    onClick={() => setSelectedId(isSelected ? null : student.id)}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      cursor: 'pointer',
                      background: isSelected ? '#f0f9ff' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        (e.currentTarget as HTMLTableRowElement).style.background = '#f8fafc';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        (e.currentTarget as HTMLTableRowElement).style.background = 'transparent';
                      }
                    }}
                  >
                    <td style={{ padding: '9px 12px', fontWeight: 500 }}>
                      {prettifyName({ displayName: student.displayName, email: student.email })}
                    </td>
                    <td style={{ padding: '9px 12px', color: '#4b5563' }}>
                      {student.email}
                    </td>
                    <td style={{ padding: '9px 12px', color: '#4b5563' }}>
                      {student.cohort?.name ?? <span style={{ color: '#9ca3af' }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 12px' }}>
                      {student.externalAccountTypes.length === 0
                        ? <span style={{ color: '#9ca3af' }}>—</span>
                        : student.externalAccountTypes.map((t) => (
                            <AccountBadge key={t} type={t} />
                          ))}
                    </td>
                    <td style={{ padding: '9px 12px', color: '#4b5563', whiteSpace: 'nowrap' }}>
                      {new Date(student.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
