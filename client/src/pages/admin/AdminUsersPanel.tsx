/**
 * AdminUsersPanel — /admin/users.
 *
 * Shows ALL active users with search, lozenge filters, and sortable column
 * headers. Admins can use the per-row action menu to Edit, Delete,
 * Impersonate, and — for rows whose role is STAFF or ADMIN — toggle admin
 * access ("Make admin" / "Remove admin").
 *
 * Filter UI:
 *   - Role lozenge bar (radio): All | Staff | Admin | Student.
 *   - Feature lozenge bar (multi-select toggle): Google | Pike 13 | GitHub |
 *     LLM Proxy | OAuth Client. Multiple active = intersection.
 *
 * Bulk actions: Delete (existing), Suspend accounts, Revoke LLM Proxy.
 *
 * Make-admin guards (also enforced server-side):
 *   - self-demotion is blocked (server 403, button disabled client-side)
 *   - demoting the final admin is blocked (server 409, button disabled
 *     client-side)
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { prettifyName } from './utils/prettifyName';
import { isRecent, NEW_USER_BG } from '../../lib/recent-user';
import ConfirmDialog from '../../components/ConfirmDialog';

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
  externalAccountTypes: string[];
  externalAccounts?: UserExternalAccount[];
  createdAt: string;
  llmProxyEnabled: boolean;
  oauthClientCount: number;
}

interface BulkSuspendResult {
  succeeded: number[];
  failed: Array<{ accountId: number; userId: number; type: string; error: string }>;
  totalEligible: number;
}

interface BulkRevokeResult {
  succeeded: number[];
  failed: Array<{ userId: number; error: string }>;
  skipped: number[];
}

// ---------------------------------------------------------------------------
// Role / Feature filter types
// ---------------------------------------------------------------------------

type RoleFilter = 'all' | 'staff' | 'admin' | 'student';

type FeatureToggle = 'google' | 'pike13' | 'github' | 'llm-proxy' | 'oauth-client';

// ---------------------------------------------------------------------------
// Sort types
// ---------------------------------------------------------------------------

type SortCol = 'name' | 'email' | 'accounts' | 'joined';

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

function applyRoleFilter(users: AdminUser[], roleFilter: RoleFilter): AdminUser[] {
  if (roleFilter === 'all') return users;
  return users.filter((u) => normalizeRole(u.role) === roleFilter);
}

function featurePredicate(u: AdminUser, toggle: FeatureToggle): boolean {
  switch (toggle) {
    case 'google':
      return u.providers.some((p) => p.provider === 'google');
    case 'pike13':
      return u.externalAccountTypes.includes('pike13');
    case 'github':
      return u.providers.some((p) => p.provider === 'github');
    case 'llm-proxy':
      return u.llmProxyEnabled === true;
    case 'oauth-client':
      return (u.oauthClientCount ?? 0) > 0;
  }
}

function applyFeatureFilter(users: AdminUser[], activeToggles: Set<FeatureToggle>): AdminUser[] {
  if (activeToggles.size === 0) return users;
  const toggles = [...activeToggles];
  return users.filter((u) => toggles.every((t) => featurePredicate(u, t)));
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

// ---------------------------------------------------------------------------
// Lozenge bar components
// ---------------------------------------------------------------------------

interface RoleLozengeBarProps {
  value: RoleFilter;
  onChange: (v: RoleFilter) => void;
}

const ROLE_OPTIONS: { label: string; value: RoleFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Staff', value: 'staff' },
  { label: 'Admin', value: 'admin' },
  { label: 'Student', value: 'student' },
];

function RoleLozengeBar({ value, onChange }: RoleLozengeBarProps) {
  return (
    <div style={lozengeBarStyle} role="group" aria-label="Role filter">
      {ROLE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          style={lozengePillStyle(value === opt.value, 'radio')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface FeatureLozengeBarProps {
  active: Set<FeatureToggle>;
  onChange: (v: Set<FeatureToggle>) => void;
}

const FEATURE_OPTIONS: { label: string; value: FeatureToggle }[] = [
  { label: 'Google', value: 'google' },
  { label: 'Pike 13', value: 'pike13' },
  { label: 'GitHub', value: 'github' },
  { label: 'LLM Proxy', value: 'llm-proxy' },
  { label: 'OAuth Client', value: 'oauth-client' },
];

function FeatureLozengeBar({ active, onChange }: FeatureLozengeBarProps) {
  function toggle(v: FeatureToggle) {
    const next = new Set(active);
    if (next.has(v)) {
      next.delete(v);
    } else {
      next.add(v);
    }
    onChange(next);
  }

  return (
    <div style={lozengeBarStyle} role="group" aria-label="Feature filter">
      {FEATURE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={active.has(opt.value)}
          onClick={() => toggle(opt.value)}
          style={lozengePillStyle(active.has(opt.value), 'toggle')}
        >
          {opt.label}
        </button>
      ))}
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
// Bulk-action API helpers
// ---------------------------------------------------------------------------

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

async function bulkRevokeLlmProxy(userIds: number[]): Promise<BulkRevokeResult> {
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

// ---------------------------------------------------------------------------
// Confirm-dialog state shape
// ---------------------------------------------------------------------------

type ConfirmState =
  | { open: false }
  | {
      open: true;
      title: string;
      message: string;
      confirmLabel: string;
      onConfirm: () => void;
    };

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

  // Bulk-suspend mutation
  const suspendMutation = useMutation<BulkSuspendResult, Error, number[]>({
    mutationFn: bulkSuspendAccounts,
    onSuccess: (result) => {
      const s = result.succeeded.length;
      const f = result.failed.length;
      if (f > 0) {
        setBulkError(
          `Suspend: ${s} succeeded, ${f} failed — ${result.failed
            .map((x) => `user ${x.userId} (${x.type}): ${x.error}`)
            .join('; ')}`,
        );
      }
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => setBulkError(err.message),
  });

  // Bulk-revoke LLM proxy mutation
  const revokeMutation = useMutation<BulkRevokeResult, Error, number[]>({
    mutationFn: bulkRevokeLlmProxy,
    onSuccess: (result) => {
      const s = result.succeeded.length;
      const f = result.failed.length;
      if (f > 0) {
        setBulkError(
          `Revoke LLM Proxy: ${s} succeeded, ${f} failed — ${result.failed
            .map((x) => `user ${x.userId}: ${x.error}`)
            .join('; ')}`,
        );
      }
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => setBulkError(err.message),
  });

  // adminCount: number of ADMIN-role users in the full (unfiltered) list.
  // Used to guard last-admin demotion client-side.
  const adminCount = users.filter((u) => u.role.toLowerCase() === 'admin').length;

  // Filter / search / sort state
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [featureToggles, setFeatureToggles] = useState<Set<FeatureToggle>>(new Set());
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

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState<ConfirmState>({ open: false });

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

  // Apply filters in sequence: role → feature → search → sort.
  // useMemo must be called unconditionally (before any early returns).
  const filtered = useMemo(
    () =>
      applySearch(
        applyFeatureFilter(applyRoleFilter(users, roleFilter), featureToggles),
        search,
      ),
    [users, roleFilter, featureToggles, search],
  );
  const visible = useMemo(
    () => sortUsers(filtered, sortCol, sortDir),
    [filtered, sortCol, sortDir],
  );

  if (loading) return <p>Loading users...</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error}</p>;

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

  // Determine which selected users are eligible for each bulk action.
  // Use the full users list (not just visible) so selections survive filter changes.
  const selectedUsers = users.filter((u) => selected.has(u.id));
  const hasEligibleForSuspend = selectedUsers.some(
    (u) => normalizeRole(u.role) === 'student',
  );
  const hasEligibleForRevoke = selectedUsers.some((u) => u.llmProxyEnabled === true);

  function openSuspendConfirm() {
    const eligibleCount = selectedUsers.filter(
      (u) => normalizeRole(u.role) === 'student',
    ).length;
    setConfirmState({
      open: true,
      title: 'Suspend accounts',
      message: `Suspend every active workspace + Claude account for ${eligibleCount} student${eligibleCount === 1 ? '' : 's'} in the selection? Non-student users are skipped.`,
      confirmLabel: 'Suspend',
      onConfirm: () => {
        setConfirmState({ open: false });
        const ids = selectedUsers
          .filter((u) => normalizeRole(u.role) === 'student')
          .map((u) => u.id);
        suspendMutation.mutate(ids);
      },
    });
  }

  function openRevokeConfirm() {
    const eligibleCount = selectedUsers.filter((u) => u.llmProxyEnabled).length;
    setConfirmState({
      open: true,
      title: 'Revoke LLM Proxy',
      message: `Revoke LLM proxy tokens for ${eligibleCount} user${eligibleCount === 1 ? '' : 's'} in the selection? Their tokens will stop working immediately.`,
      confirmLabel: 'Revoke',
      onConfirm: () => {
        setConfirmState({ open: false });
        const ids = selectedUsers.filter((u) => u.llmProxyEnabled).map((u) => u.id);
        revokeMutation.mutate(ids);
      },
    });
  }

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
          <button
            style={bulkButtonStyle('warning')}
            disabled={!hasEligibleForSuspend || suspendMutation.isPending}
            onClick={openSuspendConfirm}
            aria-label="Suspend accounts"
          >
            {suspendMutation.isPending ? 'Suspending...' : 'Suspend accounts'}
          </button>
          <button
            style={bulkButtonStyle('danger')}
            disabled={!hasEligibleForRevoke || revokeMutation.isPending}
            onClick={openRevokeConfirm}
            aria-label="Revoke LLM Proxy"
          >
            {revokeMutation.isPending ? 'Revoking...' : 'Revoke LLM Proxy'}
          </button>
        </div>
      )}

      {/* Toolbar: search */}
      <div style={toolbarStyle}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          style={searchInputStyle}
          aria-label="Search users"
        />
      </div>

      {/* Role lozenge bar */}
      <RoleLozengeBar value={roleFilter} onChange={setRoleFilter} />

      {/* Feature lozenge bar */}
      <FeatureLozengeBar active={featureToggles} onChange={setFeatureToggles} />

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

      {/* Confirm dialog for bulk suspend / revoke */}
      {confirmState.open && (
        <ConfirmDialog
          open={confirmState.open}
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
// Styles
// ---------------------------------------------------------------------------

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 8,
};

const lozengeBarStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginBottom: 8,
};

function lozengePillStyle(active: boolean, variant: 'radio' | 'toggle'): React.CSSProperties {
  const activeColor = variant === 'radio' ? '#1d4ed8' : '#0f766e';
  return {
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    border: active ? `2px solid ${activeColor}` : '2px solid #e2e8f0',
    borderRadius: 999,
    cursor: 'pointer',
    background: active ? (variant === 'radio' ? '#eff6ff' : '#f0fdfa') : '#f8fafc',
    color: active ? activeColor : '#475569',
    transition: 'all 0.1s',
  };
}

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

const searchInputStyle: React.CSSProperties = {
  flex: '1 1 auto',
  maxWidth: 320,
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  outline: 'none',
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
