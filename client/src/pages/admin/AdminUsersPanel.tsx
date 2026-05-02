/**
 * AdminUsersPanel — /admin/users.
 *
 * Shows ALL active users with search, filter, and sortable column headers
 * (including a "Joined" / created_at column). Admins can use the per-row
 * action menu to Edit, Delete, Impersonate, and — for rows whose role is
 * STAFF or ADMIN — toggle admin access ("Make admin" / "Remove admin").
 *
 * Make-admin guards (also enforced server-side):
 *   - self-demotion is blocked (server 403, button disabled client-side)
 *   - demoting the final admin is blocked (server 409, button disabled
 *     client-side)
 */

import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { prettifyName } from './utils/prettifyName';
import { isRecent, NEW_USER_BG } from '../../lib/recent-user';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserProvider {
  provider: string;
  email?: string | null;
  username?: string | null;
}

interface UserExternalAccount {
  type: string;
  externalId: string | null;
  status: string;
}

interface AdminUser {
  id: number;
  email: string;
  displayName: string | null;
  role: string;
  provider: string | null;
  providers: UserProvider[];
  cohort: { id: number; name: string } | null;
  externalAccountTypes: string[];
  externalAccounts?: UserExternalAccount[];
  createdAt: string;
}

interface CohortOption {
  id: number;
  name: string;
  google_ou_path: string | null;
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

type FilterOption =
  | { type: 'all' }
  | { type: 'admin-staff' }
  | { type: 'students' }
  | { type: 'account-google' }
  | { type: 'account-league' }
  | { type: 'account-pike13' }
  | { type: 'account-claude' }
  | { type: 'cohort'; cohortId: number; cohortName: string };

// ---------------------------------------------------------------------------
// Sort types
// ---------------------------------------------------------------------------

type SortCol = 'name' | 'email' | 'cohort' | 'accounts' | 'joined';

// Account chip identifiers rendered in the Accounts column, ordered so
// they sort in a stable, meaningful way. League accounts are split into
// staff (flag) vs student (bolt) by whether "student" appears in any
// jointheleague.org address on the user.
type AccountKind = 'google' | 'github' | 'league-staff' | 'league-student' | 'pike13' | 'claude';
const ACCOUNT_ORDER: AccountKind[] = ['league-staff', 'league-student', 'google', 'github', 'claude', 'pike13'];

/** Any @jointheleague.org address attached to the user (primary, a login
 *  email, or a workspace external_id). */
function leagueEmails(u: AdminUser): string[] {
  const out: string[] = [];
  const add = (e?: string | null) => {
    if (e && e.toLowerCase().endsWith('@jointheleague.org')) out.push(e.toLowerCase());
    else if (e && e.toLowerCase().endsWith('.jointheleague.org')) out.push(e.toLowerCase());
  };
  add(u.email);
  for (const p of u.providers ?? []) add(p.email ?? null);
  for (const a of u.externalAccounts ?? []) {
    if (a.type === 'workspace') add(a.externalId ?? null);
  }
  return out;
}

function userAccounts(u: AdminUser): AccountKind[] {
  const out = new Set<AccountKind>();
  // League account: any @jointheleague.org address. Split staff vs student
  // by whether the token "student" appears in any of those emails (covers
  // @students.jointheleague.org and any other student.* local parts).
  const leagues = leagueEmails(u);
  if (leagues.length > 0) {
    const hasStudent = leagues.some((e) => /student/i.test(e));
    out.add(hasStudent ? 'league-student' : 'league-staff');
  }
  // Google Login (external Google sign-in, e.g. gmail.com)
  if (u.providers?.some((p) => p.provider === 'google')) out.add('google');
  // GitHub login linked to this user
  if (u.providers?.some((p) => p.provider === 'github')) out.add('github');
  const eats = u.externalAccountTypes ?? [];
  if (eats.includes('claude')) out.add('claude');
  if (eats.includes('pike13')) out.add('pike13');
  return ACCOUNT_ORDER.filter((k) => out.has(k));
}

function accountsSortKey(u: AdminUser): string {
  // Sort alphabetically by the concatenated kinds (so users with the same
  // account set cluster together), with count desc as a tiebreaker.
  const accts = userAccounts(u);
  return `${String(9 - accts.length).padStart(2, '0')}-${accts.join(',')}`;
}

function userEmails(u: AdminUser): string[] {
  // Primary email first, then unique provider_email values from Logins
  // that are not the same as the primary. Typically: primary + workspace
  // email (e.g., student@students.jointheleague.org) for students who
  // have a League workspace account.
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (e?: string | null) => {
    if (!e) return;
    const norm = e.toLowerCase();
    if (seen.has(norm)) return;
    seen.add(norm);
    out.push(e);
  };
  add(u.email);
  for (const p of u.providers ?? []) add(p.email ?? null);
  // Workspace external_id is the League email
  for (const a of u.externalAccounts ?? []) {
    if (a.type === 'workspace' && a.externalId) add(a.externalId);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeRole(role: string): 'admin' | 'staff' | 'student' {
  const r = role.toLowerCase();
  if (r === 'admin') return 'admin';
  if (r === 'staff') return 'staff';
  return 'student';
}

function cohortLabel(user: AdminUser): string {
  const role = normalizeRole(user.role);
  if (role === 'admin') return 'admin';
  if (role === 'staff') return 'staff';
  return user.cohort?.name ?? '—';
}

function filterUsers(users: AdminUser[], filter: FilterOption): AdminUser[] {
  switch (filter.type) {
    case 'all':
      return users;
    case 'admin-staff':
      return users.filter((u) => {
        const r = normalizeRole(u.role);
        return r === 'admin' || r === 'staff';
      });
    case 'students':
      return users.filter((u) => normalizeRole(u.role) === 'student');
    case 'account-google':
      return users.filter((u) => u.providers.some((p) => p.provider === 'google'));
    case 'account-league':
      // Anyone whose primary_email, a login email, or their workspace
      // ExternalAccount external_id ends in @jointheleague.org — covers
      // students/staff/admins whether or not we've minted an app-local
      // workspace ExternalAccount row for them.
      return users.filter((u) => {
        if (u.email?.toLowerCase().endsWith('@jointheleague.org')) return true;
        if ((u.providers ?? []).some((p) => p.email?.toLowerCase().endsWith('@jointheleague.org'))) return true;
        if (
          (u.externalAccounts ?? []).some(
            (a) => a.type === 'workspace' && a.externalId?.toLowerCase().endsWith('@jointheleague.org'),
          )
        ) return true;
        return false;
      });
    case 'account-pike13':
      return users.filter((u) => u.externalAccountTypes.includes('pike13'));
    case 'account-claude':
      return users.filter((u) => u.externalAccountTypes.includes('claude'));
    case 'cohort':
      return users.filter((u) => u.cohort?.id === filter.cohortId);
    default:
      return users;
  }
}

function applySearch(users: AdminUser[], search: string): AdminUser[] {
  const q = search.trim().toLowerCase();
  if (!q) return users;
  return users.filter(
    (u) =>
      (u.displayName ?? '').toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      prettifyName(u).toLowerCase().includes(q),
  );
}

function sortUsers(users: AdminUser[], col: SortCol, dir: 'asc' | 'desc'): AdminUser[] {
  const sorted = [...users].sort((a, b) => {
    let cmp = 0;
    switch (col) {
      case 'name':
        cmp = prettifyName(a).localeCompare(prettifyName(b));
        break;
      case 'email':
        cmp = a.email.localeCompare(b.email);
        break;
      case 'cohort':
        cmp = cohortLabel(a).localeCompare(cohortLabel(b));
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

function filterLabel(filter: FilterOption): string {
  switch (filter.type) {
    case 'all':
      return 'Filter: All';
    case 'admin-staff':
      return 'Filter: Admin & Staff';
    case 'students':
      return 'Filter: Students';
    case 'account-google':
      return 'Filter: Google';
    case 'account-league':
      return 'Filter: League';
    case 'account-pike13':
      return 'Filter: Pike13';
    case 'account-claude':
      return 'Filter: Claude';
    case 'cohort':
      return `Filter: ${filter.cohortName}`;
    default:
      return 'Filter';
  }
}

// ---------------------------------------------------------------------------
// Provider badge
// ---------------------------------------------------------------------------

const PROVIDER_LOGOS: Record<string, { src: string; alt: string }> = {
  github: { src: 'https://github.githubassets.com/favicons/favicon-dark.svg', alt: 'GitHub' },
  google: { src: 'https://www.google.com/favicon.ico', alt: 'Google' },
  pike13: { src: 'https://www.pike13.com/favicon.ico', alt: 'Pike 13' },
};

function AccountIcon({ kind }: { kind: AccountKind }) {
  const common = { width: 20, height: 20, verticalAlign: 'middle' as const };
  if (kind === 'google') {
    return (
      <img
        src="https://www.google.com/favicon.ico"
        alt="Google"
        title="External Google account"
        style={common}
      />
    );
  }
  if (kind === 'github') {
    return (
      <img
        src={PROVIDER_LOGOS.github.src}
        alt="GitHub"
        title="GitHub account linked"
        style={common}
      />
    );
  }
  if (kind === 'league-staff') {
    return (
      <img
        src="https://images.jointheleague.org/logos/flag.png"
        alt="League staff"
        title="League staff account (@jointheleague.org)"
        style={common}
      />
    );
  }
  if (kind === 'league-student') {
    return (
      <img
        src="https://images.jointheleague.org/logos/bolt.png"
        alt="League student"
        title="League student account (student in address)"
        style={common}
      />
    );
  }
  if (kind === 'claude') {
    return (
      <img
        src="https://www.anthropic.com/favicon.ico"
        alt="Claude"
        title="Claude (Anthropic) account"
        style={common}
      />
    );
  }
  // Pike13 — just text per spec
  return (
    <span
      title="Pike13 account"
      style={{
        fontSize: 11,
        padding: '2px 6px',
        background: '#fef3c7',
        borderRadius: 4,
        color: '#92400e',
        fontWeight: 600,
      }}
    >
      Pike13
    </span>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const logo = PROVIDER_LOGOS[provider];
  if (logo) {
    return (
      <img
        src={logo.src}
        alt={logo.alt}
        title={logo.alt}
        style={{ width: 18, height: 18, verticalAlign: 'middle' }}
      />
    );
  }
  return (
    <span
      title={provider}
      style={{
        fontSize: 11,
        padding: '2px 6px',
        background: '#e2e8f0',
        borderRadius: 4,
        color: '#475569',
      }}
    >
      {provider}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Filter dropdown
// ---------------------------------------------------------------------------

interface FilterDropdownProps {
  filter: FilterOption;
  onSelect: (f: FilterOption) => void;
  cohorts: CohortOption[];
}

function FilterDropdown({ filter, onSelect, cohorts }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click (the menu is a portal so we check both refs).
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Compute viewport-relative coords whenever the menu opens or the
  // window resizes. Using viewport coords + position:fixed means the
  // menu escapes any ancestor with overflow:auto.
  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const el = buttonRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCoords({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 220) });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  function choose(f: FilterOption) {
    onSelect(f);
    setOpen(false);
  }

  const isActive = (f: FilterOption) => JSON.stringify(f) === JSON.stringify(filter);

  const menu = open && coords
    ? createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{
            ...dropdownMenuStyle,
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            minWidth: coords.width,
            maxHeight: `calc(100vh - ${coords.top + 16}px)`,
          }}
        >
          {/* Role section */}
          <div style={sectionHeaderStyle}>Role</div>
          {[
            { label: 'All', value: { type: 'all' } as FilterOption },
            { label: 'Admin & Staff', value: { type: 'admin-staff' } as FilterOption },
            { label: 'Students', value: { type: 'students' } as FilterOption },
          ].map((item) => (
            <button
              key={item.label}
              role="option"
              aria-selected={isActive(item.value)}
              onClick={() => choose(item.value)}
              style={dropdownItemStyle(isActive(item.value))}
            >
              {item.label}
            </button>
          ))}

          <div style={separatorStyle} />

          {/* Accounts section */}
          <div style={sectionHeaderStyle}>Accounts</div>
          {[
            { label: 'Google', value: { type: 'account-google' } as FilterOption },
            { label: 'League', value: { type: 'account-league' } as FilterOption },
            { label: 'Claude', value: { type: 'account-claude' } as FilterOption },
            { label: 'Pike13', value: { type: 'account-pike13' } as FilterOption },
          ].map((item) => (
            <button
              key={item.label}
              role="option"
              aria-selected={isActive(item.value)}
              onClick={() => choose(item.value)}
              style={dropdownItemStyle(isActive(item.value))}
            >
              {item.label}
            </button>
          ))}

          {/* Cohort section — only shown if there are cohorts with google_ou_path */}
          {cohorts.length > 0 && (
            <>
              <div style={separatorStyle} />
              <div style={sectionHeaderStyle}>Cohort</div>
              {cohorts.map((c) => {
                const f: FilterOption = { type: 'cohort', cohortId: c.id, cohortName: c.name };
                return (
                  <button
                    key={c.id}
                    role="option"
                    aria-selected={isActive(f)}
                    onClick={() => choose(f)}
                    style={dropdownItemStyle(isActive(f))}
                  >
                    {c.name}
                  </button>
                );
              })}
            </>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        style={dropdownButtonStyle}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {filterLabel(filter)}
        <span style={{ marginLeft: 6, fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>
      {menu}
    </div>
  );
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
      style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }}
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
// Three-dot row actions menu
// ---------------------------------------------------------------------------

interface RowMenuProps {
  user: AdminUser;
  isOwnRow: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onImpersonate: () => void;
  /** Defined only for STAFF/ADMIN rows — omit for students. */
  onSetRole?: () => void;
  /** Whether the role-toggle action is disabled (self, last-admin). */
  roleToggleDisabled?: boolean;
  /** Title attribute on the role-toggle button. */
  roleToggleTitle?: string;
  /** Label for the role-toggle action: "Make admin" | "Remove admin". */
  roleToggleLabel?: string;
}

function RowMenu({
  isOwnRow,
  isOpen,
  onToggle,
  onClose,
  onEdit,
  onDelete,
  onImpersonate,
  onSetRole,
  roleToggleDisabled,
  roleToggleTitle,
  roleToggleLabel,
}: RowMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, onClose]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={onToggle}
        style={dotMenuButtonStyle}
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        ⋮
      </button>
      {isOpen && (
        <div style={rowMenuStyle} role="menu">
          <button
            role="menuitem"
            disabled={isOwnRow}
            onClick={() => { onClose(); onEdit(); }}
            style={rowMenuItemStyle(isOwnRow)}
          >
            Edit
          </button>
          <button
            role="menuitem"
            disabled={isOwnRow}
            onClick={() => { onClose(); onDelete(); }}
            style={rowMenuItemStyle(isOwnRow)}
          >
            Delete
          </button>
          <button
            role="menuitem"
            disabled={isOwnRow}
            onClick={() => { onClose(); onImpersonate(); }}
            style={rowMenuItemStyle(isOwnRow)}
          >
            Impersonate
          </button>
          {onSetRole !== undefined && (
            <button
              role="menuitem"
              disabled={roleToggleDisabled}
              title={roleToggleTitle}
              onClick={() => { onClose(); onSetRole(); }}
              style={rowMenuItemStyle(!!roleToggleDisabled)}
            >
              {roleToggleLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role-change API helper
// ---------------------------------------------------------------------------

async function setRole(id: number, role: 'admin' | 'staff'): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AdminUsersPanel() {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Data — loaded via React Query so the admin SSE stream can invalidate
  // and trigger an automatic refetch when another admin mutates a user.
  const {
    data: users = [],
    isLoading: loading,
    error: queryError,
  } = useQuery<AdminUser[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const { data: cohorts = [] } = useQuery<CohortOption[]>({
    queryKey: ['admin', 'cohorts'],
    queryFn: async () => {
      const res = await fetch('/api/admin/cohorts');
      if (!res.ok) return [];
      const data: CohortOption[] = await res.json();
      return data.filter((c) => !!c.google_ou_path);
    },
  });

  const [mutationError, setMutationError] = useState('');
  const [roleError, setRoleError] = useState('');
  const error = mutationError || roleError || (queryError ? (queryError as Error).message : '');
  const [impersonating, setImpersonating] = useState<number | null>(null);

  // Role-toggle mutation (make-admin / remove-admin)
  const roleMutation = useMutation<void, Error, { id: number; role: 'admin' | 'staff' }>({
    mutationFn: ({ id, role }) => setRole(id, role),
    onSuccess: () => {
      setRoleError('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => setRoleError(err.message),
  });

  // adminCount: number of ADMIN-role users in the full (unfiltered) list.
  // Used to guard last-admin demotion client-side.
  const adminCount = users.filter((u) => u.role.toLowerCase() === 'admin').length;

  // Filter / search / sort state
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterOption>({ type: 'all' });
  // Default sort puts the most recently joined users first so newcomers
  // are immediately visible; rows created in the last 24h are also
  // highlighted in the table below.
  const [sortCol, setSortCol] = useState<SortCol>('joined');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Selection + bulk action state
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState('');

  const refetchUsers = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });

  async function handleImpersonate(user: AdminUser) {
    setImpersonating(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/impersonate`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }
      window.location.assign('/');
    } catch (err: any) {
      alert(err.message || 'Failed to impersonate user');
      setImpersonating(null);
    }
  }

  async function handleRowDelete(user: AdminUser) {
    if (!window.confirm(`Delete user "${prettifyName(user)}"?`)) return;
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
      void refetchUsers();
    } catch (err: any) {
      setMutationError(err.message || 'Failed to delete user');
    }
  }

  async function handleBulkDelete() {
    if (!window.confirm(`Delete ${selected.size} user(s)?`)) return;
    setBulkDeleting(true);
    setBulkError('');
    const ids = [...selected];
    const results = await Promise.allSettled(
      ids.map((id) => fetch(`/api/admin/users/${id}`, { method: 'DELETE' })),
    );
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      setBulkError(`${failures.length} deletion(s) failed.`);
    }
    await refetchUsers();
    setSelected(new Set());
    setBulkDeleting(false);
  }

  function handleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  if (loading) return <p>Loading users...</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;

  const filtered = applySearch(filterUsers(users, activeFilter), search);
  const visible = sortUsers(filtered, sortCol, sortDir);

  // Selectable rows: non-own rows
  const selectableIds = visible
    .filter((u) => u.id !== currentUser?.id)
    .map((u) => u.id);

  const allVisibleSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id));

  function toggleAll() {
    if (allVisibleSelected) {
      // Deselect all visible
      setSelected((prev) => {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      // Select all visible
      setSelected((prev) => {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  function toggleRow(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Count only selected rows that are still visible
  const visibleSelectedCount = visible.filter((u) => selected.has(u.id)).length;

  return (
    <div>
      <h2 style={{ margin: '0 0 16px', fontSize: 20 }}>Users</h2>

      {/* Bulk error banner */}
      {bulkError && (
        <div role="alert" style={errorBannerStyle}>
          {bulkError}
          <button
            onClick={() => setBulkError('')}
            style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#7f1d1d', fontWeight: 700 }}
            aria-label="Dismiss error"
          >
            x
          </button>
        </div>
      )}

      {/* Role-change error banner */}
      {roleError && (
        <div role="alert" style={errorBannerStyle}>
          {roleError}
          <button
            onClick={() => setRoleError('')}
            style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#7f1d1d', fontWeight: 700 }}
            aria-label="Dismiss error"
          >
            x
          </button>
        </div>
      )}

      {/* Bulk-action toolbar — visible when ≥1 row selected */}
      {visibleSelectedCount > 0 && (
        <div style={bulkToolbarStyle} role="toolbar" aria-label="Bulk actions">
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
            {visibleSelectedCount} selected
          </span>
          <span style={{ color: '#cbd5e1', margin: '0 8px' }}>—</span>
          <button
            style={bulkButtonStyle('secondary')}
            onClick={() => {/* stub: bulk edit coming later */}}
            aria-label="Bulk edit"
          >
            Edit
          </button>
          <button
            style={bulkButtonStyle('danger')}
            disabled={bulkDeleting}
            onClick={() => void handleBulkDelete()}
            aria-label="Bulk delete"
          >
            {bulkDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      )}

      {/* Toolbar: search + filter */}
      <div style={toolbarStyle}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          style={searchInputStyle}
          aria-label="Search users"
        />
        <FilterDropdown
          filter={activeFilter}
          onSelect={setActiveFilter}
          cohorts={cohorts}
        />
      </div>

      <table style={tableStyle}>
        <thead>
          <tr>
            {/* Checkbox column */}
            <th style={{ ...thStyle, width: 36, textAlign: 'center' }}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allVisibleSelected;
                }}
                onChange={toggleAll}
                disabled={selectableIds.length === 0}
                aria-label="Select all visible rows"
                style={{ cursor: selectableIds.length === 0 ? 'default' : 'pointer', width: 15, height: 15 }}
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
            <th style={{ ...thStyle, textAlign: 'center', width: 48 }}>⋮</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((user) => {
            const isOwnRow = currentUser?.id === user.id;
            const isChecked = selected.has(user.id);
            const rowBackground = isChecked
              ? '#eff6ff'
              : isRecent(user.createdAt)
                ? NEW_USER_BG
                : undefined;

            // Role-toggle props (only for STAFF/ADMIN rows)
            const normalRole = normalizeRole(user.role);
            const isStaffOrAdmin = normalRole === 'admin' || normalRole === 'staff';
            const isAdmin = normalRole === 'admin';
            const isLastAdmin = isAdmin && adminCount === 1;
            const roleToggleDisabled = roleMutation.isPending || isOwnRow || (isAdmin && isLastAdmin);
            const roleToggleTitle = isOwnRow
              ? 'You cannot change your own admin status.'
              : isLastAdmin
                ? 'Cannot demote the last remaining admin.'
                : isAdmin
                  ? 'Remove admin access.'
                  : 'Grant admin access.';
            const roleToggleLabel = isAdmin ? 'Remove admin' : 'Make admin';

            return (
              <tr key={user.id} style={rowBackground ? { background: rowBackground } : undefined}>
                {/* Checkbox cell */}
                <td style={{ ...tdStyle, width: 36, textAlign: 'center' }}>
                  {!isOwnRow && (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleRow(user.id)}
                      aria-label={`Select ${prettifyName(user)}`}
                      style={{ cursor: 'pointer', width: 15, height: 15 }}
                    />
                  )}
                </td>
                <td style={tdStyle}>
                  <Link to={`/users/${user.id}`} style={nameLinkStyle}>
                    {prettifyName(user)}
                  </Link>
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Link to={`/users/${user.id}`} style={emailLinkStyle}>
                      {user.email}
                    </Link>
                    {userEmails(user).slice(1).map((e) => (
                      <span
                        key={e}
                        style={{ color: '#64748b', fontSize: 11, marginLeft: 0 }}
                      >
                        {e}
                      </span>
                    ))}
                  </div>
                </td>
                <td style={tdStyle}>
                  <span style={cohortChipStyle(normalizeRole(user.role))}>
                    {cohortLabel(user)}
                  </span>
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {userAccounts(user).length === 0 && (
                      <span style={{ color: '#94a3b8', fontSize: 13 }}>none</span>
                    )}
                    {userAccounts(user).map((kind) => (
                      <AccountIcon key={kind} kind={kind} />
                    ))}
                  </div>
                </td>
                <td style={tdStyle}>
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center', width: 48 }}>
                  <RowMenu
                    user={user}
                    isOwnRow={isOwnRow}
                    isOpen={openMenuId === user.id}
                    onToggle={() =>
                      setOpenMenuId((prev) => (prev === user.id ? null : user.id))
                    }
                    onClose={() => setOpenMenuId(null)}
                    onEdit={() => navigate(`/users/${user.id}`)}
                    onDelete={() => void handleRowDelete(user)}
                    onImpersonate={() => void handleImpersonate(user)}
                    {...(isStaffOrAdmin
                      ? {
                          onSetRole: () =>
                            roleMutation.mutate({
                              id: user.id,
                              role: isAdmin ? 'staff' : 'admin',
                            }),
                          roleToggleDisabled,
                          roleToggleTitle,
                          roleToggleLabel,
                        }
                      : {})}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {visible.length === 0 && (
        <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: 24 }}>
          {users.length === 0 ? 'No users yet.' : 'No users match this filter.'}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 16,
};

const bulkToolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  marginBottom: 8,
  background: '#f0f9ff',
  border: '1px solid #bae6fd',
  borderRadius: 6,
};

const errorBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 12px',
  marginBottom: 8,
  background: '#fef2f2',
  border: '1px solid #fca5a5',
  borderRadius: 6,
  color: '#7f1d1d',
  fontSize: 13,
};

function bulkButtonStyle(variant: 'secondary' | 'danger'): React.CSSProperties {
  return {
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    background: variant === 'danger' ? '#dc2626' : '#e2e8f0',
    color: variant === 'danger' ? '#fff' : '#1e293b',
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

const dropdownButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 13,
  fontWeight: 600,
  background: '#f8fafc',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  cursor: 'pointer',
  color: '#0f172a',
  display: 'inline-flex',
  alignItems: 'center',
  whiteSpace: 'nowrap',
};

const dropdownMenuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  zIndex: 50,
  minWidth: 220,
  maxHeight: '70vh',
  overflowY: 'auto',
  padding: '4px 0',
};

const sectionHeaderStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#94a3b8',
  pointerEvents: 'none',
};

const separatorStyle: React.CSSProperties = {
  height: 1,
  background: '#f1f5f9',
  margin: '4px 0',
};

function dropdownItemStyle(active: boolean): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '6px 16px',
    fontSize: 13,
    background: active ? '#eff6ff' : 'transparent',
    color: active ? '#1d4ed8' : '#1e293b',
    fontWeight: active ? 600 : 400,
    border: 'none',
    cursor: 'pointer',
  };
}

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
};

const nameLinkStyle: React.CSSProperties = {
  color: '#1d4ed8',
  textDecoration: 'none',
  fontWeight: 500,
};

const emailLinkStyle: React.CSSProperties = {
  color: '#475569',
  textDecoration: 'none',
  fontSize: 13,
};

const dotMenuButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 18,
  color: '#64748b',
  padding: '2px 6px',
  borderRadius: 4,
  lineHeight: 1,
};

const rowMenuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 2,
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  zIndex: 100,
  minWidth: 140,
  padding: '4px 0',
};

function rowMenuItemStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '7px 16px',
    fontSize: 13,
    background: 'transparent',
    color: disabled ? '#cbd5e1' : '#1e293b',
    border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    fontWeight: 400,
  };
}

type NormalizedRole = 'admin' | 'staff' | 'student';

function cohortChipStyle(role: NormalizedRole): React.CSSProperties {
  const palette: Record<NormalizedRole, { bg: string; fg: string }> = {
    admin: { bg: '#fef3c7', fg: '#92400e' },
    staff: { bg: '#dbeafe', fg: '#1e40af' },
    student: { bg: '#ecfccb', fg: '#3f6212' },
  };
  const { bg, fg } = palette[role] ?? { bg: '#f1f5f9', fg: '#475569' };
  return {
    fontSize: 12,
    padding: '2px 8px',
    background: bg,
    color: fg,
    borderRadius: 999,
    fontWeight: 600,
  };
}
