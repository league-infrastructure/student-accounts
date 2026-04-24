/**
 * UserDetailPanel — admin detail view for a single user.
 *
 * Layout (top-down):
 *   1. Identity card — display name + all known email addresses.
 *   2. Account blocks, one per account kind:
 *        - External Google (read-only; only shown if present)
 *        - League         (read-only; only shown if present)
 *        - Student        (with Add / Delete buttons for students)
 *        - Pike13         (read-only snippet; only shown if linked)
 *        - Claude         (with Add / Suspend / Delete buttons)
 *   3. Danger zone (student-only) — full deprovision.
 *
 * The old table-of-ExternalAccounts layout was misleading: it mixed types
 * with different admin capabilities and showed Suspend/Remove on rows where
 * those actions were no-ops. Each kind gets its own card now.
 */

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { prettifyName } from './utils/prettifyName';
import UserGroupsCard from './UserGroupsCard';
import UserLlmProxyCard from './UserLlmProxyCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Pike13Result =
  | { present: false }
  | { present: true; person: Pike13Person }
  | { present: true; error: string };

interface Pike13Person {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  status?: string;
  custom_fields?: Record<string, unknown>;
}

interface UserDetail {
  id: number;
  email: string;
  displayName: string | null;
  role: string;
  cohort: { id: number; name: string } | null;
  createdAt: string;
  logins: Login[];
  externalAccounts: ExternalAccount[];
}

interface Login {
  id: number;
  provider: string;
  providerUserId: string;
  providerEmail: string | null;
  providerUsername: string | null;
  createdAt: string;
}

interface ExternalAccount {
  id: number;
  type: string;
  status: string;
  externalId: string | null;
  statusChangedAt: string | null;
  scheduledDeleteAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchUserDetail(id: string): Promise<UserDetail> {
  const res = await fetch(`/api/admin/users/${id}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiPost(path: string): Promise<any> {
  const res = await fetch(path, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Email classification helpers
// ---------------------------------------------------------------------------

function isStudentLeagueEmail(e: string): boolean {
  return /@students\.jointheleague\.org$/i.test(e);
}

function isStaffLeagueEmail(e: string): boolean {
  // Any *.jointheleague.org but NOT students.
  return (
    /@([a-z0-9-]+\.)?jointheleague\.org$/i.test(e) &&
    !isStudentLeagueEmail(e)
  );
}

// ---------------------------------------------------------------------------
// UserDetailPanel component
// ---------------------------------------------------------------------------

export default function UserDetailPanel() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const numericId = id ? parseInt(id, 10) : NaN;
  const userQuery = useQuery<UserDetail>({
    queryKey: ['admin', 'users', numericId, 'detail'],
    queryFn: () => fetchUserDetail(id!),
    enabled: Number.isFinite(numericId),
  });

  const user = userQuery.data ?? null;
  const loading = userQuery.isLoading;
  const pageError = userQuery.error ? (userQuery.error as Error).message : '';

  // Pike13 is an external read-only lookup; not invalidated by admin
  // mutations, so a plain useQuery with a long stale time is fine.
  const pike13Query = useQuery<Pike13Result>({
    queryKey: ['admin', 'users', numericId, 'pike13'],
    queryFn: async () => {
      const r = await fetch(`/api/admin/users/${id}/pike13`);
      if (!r.ok) return { present: true, error: 'Network error fetching Pike13 data' };
      return r.json();
    },
    enabled: Number.isFinite(numericId),
    staleTime: 60_000,
  });
  const pike13Data = pike13Query.data ?? null;

  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ['admin', 'users', numericId, 'detail'],
    });

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function run<T>(fn: () => Promise<T>, confirmMsg?: string): Promise<void> {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true); setActionError('');
    try { await fn(); await refresh(); }
    catch (err: any) { setActionError(err.message ?? 'Action failed'); }
    finally { setBusy(false); }
  }

  async function provisionStudent() {
    if (!user) return;
    await run(
      () => apiPost(`/api/admin/users/${user.id}/provision-workspace`),
      `Create a @students.jointheleague.org account for ${prettifyNameFromUser()}?\n\n` +
        `A Google Workspace account will be provisioned in the student's cohort OU.`,
    );
  }

  async function suspendExternal(account: ExternalAccount, label: string) {
    await run(
      () => apiPost(`/api/admin/external-accounts/${account.id}/suspend`),
      `Suspend the ${label}? This can be reversed.`,
    );
  }

  async function unsuspendExternal(account: ExternalAccount, label: string) {
    await run(
      () => apiPost(`/api/admin/external-accounts/${account.id}/unsuspend`),
      `Unsuspend the ${label}?`,
    );
  }

  async function removeExternal(account: ExternalAccount, label: string, note = '') {
    await run(
      () => apiPost(`/api/admin/external-accounts/${account.id}/remove`),
      `Delete the ${label}?${note ? `\n\n${note}` : ''}`,
    );
  }

  async function provisionClaude() {
    if (!user) return;
    await run(
      () => apiPost(`/api/admin/users/${user.id}/provision-claude`),
      `Invite ${prettifyNameFromUser()} to Claude?`,
    );
  }

  async function deprovision() {
    if (!user) return;
    const eligible = user.externalAccounts.filter(
      (a) => (a.type === 'workspace' || a.type === 'claude') &&
             (a.status === 'active' || a.status === 'suspended'),
    );
    const list = eligible.length === 0
      ? '  (no active workspace or claude accounts — no-op)'
      : eligible.map((a) => `  • ${a.type} [${a.status}] (id=${a.id})`).join('\n');
    await run(
      () => apiPost(`/api/admin/users/${user.id}/deprovision`),
      `Deprovision student ${user.email}?\n\nAccounts to be removed:\n${list}\n\nThis cannot be undone.`,
    );
  }

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  function prettifyNameFromUser(): string {
    if (!user) return '';
    return prettifyName({ email: user.email, displayName: user.displayName });
  }

  /** Collect every unique email we know for this user. */
  function allEmails(): string[] {
    if (!user) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (e?: string | null) => {
      if (!e) return;
      const k = e.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k); out.push(e);
    };
    add(user.email);
    for (const l of user.logins) add(l.providerEmail);
    for (const a of user.externalAccounts) {
      if (a.type === 'workspace') add(a.externalId);
    }
    return out;
  }

  /** Email addresses of a given flavor. */
  function emailsMatching(pred: (e: string) => boolean): string[] {
    return allEmails().filter(pred);
  }

  if (loading) return <p style={loadingStyle}>Loading user…</p>;
  if (pageError) return <p style={errorStyle}>{pageError}</p>;
  if (!user) return null;

  const role = (user.role ?? '').toLowerCase();
  const isStudent = role === 'student';
  const emails = allEmails();
  const studentEmails = emailsMatching(isStudentLeagueEmail);
  const leagueStaffEmails = emailsMatching(isStaffLeagueEmail);
  const externalGoogleLogin = user.logins.find(
    (l) => l.provider === 'google' &&
           !!l.providerEmail &&
           !/@([a-z0-9-]+\.)?jointheleague\.org$/i.test(l.providerEmail ?? ''),
  );
  const studentWorkspaceAcct = user.externalAccounts.find(
    (a) => a.type === 'workspace' &&
           ['active', 'pending', 'suspended'].includes(a.status) &&
           !!a.externalId && isStudentLeagueEmail(a.externalId),
  );
  const claudeAcct = user.externalAccounts.find(
    (a) => a.type === 'claude' && (a.status === 'active' || a.status === 'pending' || a.status === 'suspended'),
  );
  const claudeRemoved = user.externalAccounts.find(
    (a) => a.type === 'claude' && a.status === 'removed',
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={pageStyle}>
      <button style={backButtonStyle} onClick={() => navigate('/users')}>
        ← Back to Users
      </button>

      {actionError && (
        <div style={actionErrorStyle} role="alert">
          <strong>Error: </strong>
          <span style={{ whiteSpace: 'pre-wrap' }}>{actionError}</span>
          <button
            style={dismissButtonStyle}
            onClick={() => setActionError('')}
            aria-label="Dismiss error"
          >×</button>
        </div>
      )}

      {/* ================================================================== */}
      {/* 1. Identity                                                         */}
      {/* ================================================================== */}
      <section style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{prettifyNameFromUser()}</h1>
          <span style={roleBadgeStyle(role)}>{role || 'student'}</span>
          {user.cohort && (
            <span style={{ color: '#64748b', fontSize: 13 }}>· cohort: {user.cohort.name}</span>
          )}
        </div>
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div style={{ color: '#64748b', marginBottom: 4 }}>Email addresses</div>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#0f172a' }}>
            {emails.map((e) => (<li key={e.toLowerCase()}>{e}</li>))}
          </ul>
        </div>
      </section>

      {/* ================================================================== */}
      {/* 1b. Groups (Sprint 012 T006)                                         */}
      {/* ================================================================== */}
      <UserGroupsCard
        userId={user.id}
        userName={prettifyNameFromUser()}
      />

      {/* ================================================================== */}
      {/* 1c. LLM Proxy access (Sprint 013 T005)                               */}
      {/* ================================================================== */}
      <UserLlmProxyCard
        userId={user.id}
        userName={prettifyNameFromUser()}
      />

      {/* ================================================================== */}
      {/* 2. External Google (read-only; only if present)                     */}
      {/* ================================================================== */}
      {externalGoogleLogin && (
        <AccountCard title="External Google">
          <Kv k="Email" v={externalGoogleLogin.providerEmail ?? '—'} />
          <Kv k="Google ID" v={externalGoogleLogin.providerUserId} />
          <div style={mutedHintStyle}>Managed by Google — no admin action available here.</div>
        </AccountCard>
      )}

      {/* ================================================================== */}
      {/* 3. League (read-only; only if present)                              */}
      {/* ================================================================== */}
      {leagueStaffEmails.length > 0 && (
        <AccountCard title="League (staff)">
          {leagueStaffEmails.map((e) => (<div key={e} style={{ fontFamily: 'monospace' }}>{e}</div>))}
          <div style={mutedHintStyle}>Managed in Google Workspace — no admin action available here.</div>
        </AccountCard>
      )}

      {/* ================================================================== */}
      {/* 4. Student account (add / unsuspend / delete)                        */}
      {/* ================================================================== */}
      {(isStudent || studentEmails.length > 0) && (
        <AccountCard title="Student account">
          {studentEmails.length > 0 ? (
            <>
              {studentEmails.map((e) => (<div key={e} style={{ fontFamily: 'monospace' }}>{e}</div>))}
              {studentWorkspaceAcct ? (
                <>
                  <Kv k="Status" v={<StatusPill status={studentWorkspaceAcct.status} />} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {studentWorkspaceAcct.status === 'suspended' && (
                      <ActionButton
                        variant="primary"
                        disabled={busy}
                        onClick={() => unsuspendExternal(studentWorkspaceAcct, 'student account')}
                      >
                        Unsuspend Student Account
                      </ActionButton>
                    )}
                    <ActionButton
                      variant="danger"
                      disabled={busy || studentWorkspaceAcct.status === 'removed'}
                      onClick={() => removeExternal(
                        studentWorkspaceAcct,
                        'student account',
                        'The Google Workspace account will be suspended now and hard-deleted after 3 days.',
                      )}
                    >
                      Delete Student Account
                    </ActionButton>
                  </div>
                </>
              ) : (
                <div style={mutedHintStyle}>
                  Synced from Google; not tracked as an app-managed account.
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ color: '#64748b', fontStyle: 'italic', marginBottom: 10 }}>
                No student account yet.
              </div>
              <ActionButton
                variant="primary"
                disabled={busy || !user.cohort}
                title={user.cohort ? undefined : 'Assign a cohort before creating a student account.'}
                onClick={provisionStudent}
              >
                + Add Student Account
              </ActionButton>
            </>
          )}
        </AccountCard>
      )}

      {/* ================================================================== */}
      {/* 5. Pike13 (read-only; only if linked)                                */}
      {/* ================================================================== */}
      {pike13Data?.present === true && (
        <AccountCard title="Pike13">
          {'error' in pike13Data ? (
            <div style={{ color: '#b45309' }}>Pike13 data unavailable: {pike13Data.error}</div>
          ) : (
            <>
              <Kv k="Name" v={`${pike13Data.person.first_name} ${pike13Data.person.last_name}`} />
              <Kv k="Email" v={pike13Data.person.email} />
              {pike13Data.person.phone && <Kv k="Phone" v={pike13Data.person.phone} />}
              {pike13Data.person.status && <Kv k="Status" v={pike13Data.person.status} />}
              <Kv k="Pike13 ID" v={String(pike13Data.person.id)} />
              <div style={mutedHintStyle}>Managed in Pike13 — no admin action available here.</div>
            </>
          )}
        </AccountCard>
      )}

      {/* ================================================================== */}
      {/* 6. Claude                                                            */}
      {/* ================================================================== */}
      <AccountCard title="Claude">
        {claudeAcct ? (
          <>
            <Kv k="Status" v={<StatusPill status={claudeAcct.status} />} />
            <Kv k="Anthropic ID" v={claudeAcct.externalId ?? '—'} />
            {claudeAcct.status === 'suspended' &&
              claudeAcct.externalId &&
              !claudeAcct.externalId.startsWith('invite_') && (
                <div style={mutedHintStyle}>
                  Claude user accounts can't be un-suspended — delete this account
                  and re-invite with + Add Claude Account.
                </div>
              )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {claudeAcct.status === 'suspended' &&
                claudeAcct.externalId?.startsWith('invite_') && (
                  <ActionButton
                    variant="primary"
                    disabled={busy}
                    onClick={() => unsuspendExternal(claudeAcct, 'Claude account')}
                  >
                    Unsuspend Claude
                  </ActionButton>
                )}
              <ActionButton
                variant="warning"
                disabled={busy || claudeAcct.status !== 'active'}
                onClick={() => suspendExternal(claudeAcct, 'Claude account')}
              >
                Disable Claude
              </ActionButton>
              <ActionButton
                variant="danger"
                disabled={busy}
                onClick={() => removeExternal(claudeAcct, 'Claude account')}
              >
                Delete Claude
              </ActionButton>
            </div>
          </>
        ) : (
          <>
            {claudeRemoved && (
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>
                Previously removed — re-invite below.
              </div>
            )}
            <div style={{ color: '#64748b', fontStyle: 'italic', marginBottom: 10 }}>
              No Claude account.
            </div>
            <ActionButton
              variant="primary"
              disabled={busy}
              onClick={provisionClaude}
            >
              + Add Claude Account
            </ActionButton>
          </>
        )}
      </AccountCard>

      {/* ================================================================== */}
      {/* 7. Danger zone                                                       */}
      {/* ================================================================== */}
      {isStudent && (
        <section style={dangerZoneStyle}>
          <h3 style={{ margin: '0 0 6px', color: '#b91c1c', fontSize: 14 }}>Danger Zone</h3>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: '#475569' }}>
            Deprovision removes all active Workspace and Claude accounts for this student. Pike13 and external Google logins are not touched.
          </p>
          <ActionButton variant="danger" disabled={busy} onClick={deprovision}>
            Deprovision Student
          </ActionButton>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function AccountCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={cardStyle}>
      <h2 style={cardTitleStyle}>{title}</h2>
      {children}
    </section>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 2 }}>
      <div style={{ color: '#64748b', minWidth: 100 }}>{k}</div>
      <div style={{ color: '#0f172a' }}>{v}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const c =
    status === 'active' ? { bg: '#d1fae5', fg: '#065f46' }
    : status === 'pending' ? { bg: '#fef3c7', fg: '#92400e' }
    : status === 'suspended' ? { bg: '#fed7aa', fg: '#9a3412' }
    : { bg: '#e2e8f0', fg: '#475569' };
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', background: c.bg, color: c.fg, borderRadius: 999, fontWeight: 600 }}>
      {status}
    </span>
  );
}

type ButtonVariant = 'primary' | 'warning' | 'danger';

function ActionButton({
  variant,
  disabled,
  onClick,
  children,
  title,
}: {
  variant: ButtonVariant;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  const bg = variant === 'primary' ? '#2563eb' : variant === 'warning' ? '#d97706' : '#dc2626';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: '7px 14px',
        background: bg,
        color: '#fff',
        border: 'none',
        borderRadius: 6,
        fontWeight: 600,
        fontSize: 13,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function roleBadgeStyle(role: string): React.CSSProperties {
  const palette: Record<string, { bg: string; fg: string }> = {
    admin:   { bg: '#fef3c7', fg: '#92400e' },
    staff:   { bg: '#dbeafe', fg: '#1e40af' },
    student: { bg: '#ecfccb', fg: '#3f6212' },
  };
  const { bg, fg } = palette[role] ?? palette.student;
  return { fontSize: 12, padding: '2px 8px', background: bg, color: fg, borderRadius: 999, fontWeight: 600 };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageStyle: React.CSSProperties = { maxWidth: 780 };
const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '16px 18px',
  marginBottom: 14,
  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
};
const cardTitleStyle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 14,
  fontWeight: 700,
  color: '#0f172a',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
const dangerZoneStyle: React.CSSProperties = {
  ...cardStyle,
  border: '1px solid #fecaca',
  background: '#fef2f2',
};
const mutedHintStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: '#94a3b8',
  fontStyle: 'italic',
};
const backButtonStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  padding: '4px 10px',
  cursor: 'pointer',
  marginBottom: 14,
  fontSize: 13,
};
const loadingStyle: React.CSSProperties = { color: '#64748b' };
const errorStyle: React.CSSProperties = { color: '#dc2626' };
const actionErrorStyle: React.CSSProperties = {
  position: 'relative',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  color: '#991b1b',
  padding: '10px 36px 10px 12px',
  borderRadius: 6,
  fontSize: 13,
  marginBottom: 14,
};
const dismissButtonStyle: React.CSSProperties = {
  position: 'absolute',
  right: 8,
  top: 8,
  background: 'transparent',
  border: 'none',
  color: '#991b1b',
  fontSize: 18,
  cursor: 'pointer',
  lineHeight: 1,
};
