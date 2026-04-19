/**
 * UserDetailPanel — admin detail view for a single user.
 *
 * Shows:
 *   - User identity (email, display name, role, cohort)
 *   - Logins table with Remove button (disabled when last login) + Add Login form
 *   - External Accounts table with Suspend/Remove buttons + Provision Claude Seat
 *   - Deprovision Student button (red, confirm dialog)
 *
 * Route: /admin/users/:id
 *
 * All destructive actions use window.confirm before making the API call.
 * Page state refreshes after each successful action without a full reload.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface AddLoginForm {
  provider: 'google' | 'github';
  providerUserId: string;
  providerEmail: string;
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

async function apiDelete(path: string): Promise<void> {
  const res = await fetch(path, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// UserDetailPanel component
// ---------------------------------------------------------------------------

export default function UserDetailPanel() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  // Add-login form state
  const [showAddLogin, setShowAddLogin] = useState(false);
  const [addLoginForm, setAddLoginForm] = useState<AddLoginForm>({
    provider: 'google',
    providerUserId: '',
    providerEmail: '',
  });
  const [addLoginError, setAddLoginError] = useState('');

  const refresh = useCallback(async () => {
    if (!id) return;
    setPageError('');
    try {
      const data = await fetchUserDetail(id);
      setUser(data);
    } catch (err: any) {
      setPageError(err.message ?? 'Failed to load user');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // -------------------------------------------------------------------------
  // External account actions
  // -------------------------------------------------------------------------

  async function handleSuspend(account: ExternalAccount) {
    const label = `${account.type} account (id=${account.id})`;
    if (!window.confirm(`Suspend ${label}? This action can be reversed.`)) return;
    setBusy(true);
    setActionError('');
    try {
      await apiPost(`/api/admin/external-accounts/${account.id}/suspend`);
      await refresh();
    } catch (err: any) {
      setActionError(err.message ?? 'Suspend failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveAccount(account: ExternalAccount) {
    const label = `${account.type} account (id=${account.id})`;
    const extraNote = account.type === 'workspace'
      ? '\n\nNote: The Google Workspace account will be hard-deleted after 3 days.'
      : '';
    if (!window.confirm(`Remove ${label}?${extraNote}`)) return;
    setBusy(true);
    setActionError('');
    try {
      await apiPost(`/api/admin/external-accounts/${account.id}/remove`);
      await refresh();
    } catch (err: any) {
      setActionError(err.message ?? 'Remove failed');
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Provision Claude
  // -------------------------------------------------------------------------

  async function handleProvisionClaude() {
    if (!user) return;
    if (!window.confirm(`Provision a Claude Team seat for ${user.email}?`)) return;
    setBusy(true);
    setActionError('');
    try {
      await apiPost(`/api/admin/users/${user.id}/provision-claude`);
      await refresh();
    } catch (err: any) {
      setActionError(err.message ?? 'Provision failed');
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Deprovision student
  // -------------------------------------------------------------------------

  async function handleDeprovision() {
    if (!user) return;
    const eligible = user.externalAccounts.filter(
      (a) =>
        (a.type === 'workspace' || a.type === 'claude') &&
        (a.status === 'active' || a.status === 'suspended'),
    );
    const accountList = eligible.length === 0
      ? '  (no active workspace or claude accounts — no-op)'
      : eligible.map((a) => `  • ${a.type} [${a.status}] (id=${a.id})`).join('\n');

    const confirmed = window.confirm(
      `Deprovision student ${user.email}?\n\nAccounts to be removed:\n${accountList}\n\nThis cannot be undone.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setActionError('');
    try {
      const result = await apiPost(`/api/admin/users/${user.id}/deprovision`);
      if (result.failed && result.failed.length > 0) {
        const failMsg = result.failed
          .map((f: { accountId: number; error: string }) => `  • account ${f.accountId}: ${f.error}`)
          .join('\n');
        setActionError(`Deprovision partial failure — some accounts could not be removed:\n${failMsg}`);
      }
      await refresh();
    } catch (err: any) {
      setActionError(err.message ?? 'Deprovision failed');
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Login actions
  // -------------------------------------------------------------------------

  async function handleRemoveLogin(login: Login) {
    if (!user) return;
    if (!window.confirm(`Remove ${login.provider} login (${login.providerEmail ?? login.providerUserId})?`)) return;
    setBusy(true);
    setActionError('');
    try {
      await apiDelete(`/api/admin/users/${user.id}/logins/${login.id}`);
      await refresh();
    } catch (err: any) {
      setActionError(err.message ?? 'Remove login failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!addLoginForm.providerUserId.trim()) {
      setAddLoginError('Provider User ID is required');
      return;
    }
    setBusy(true);
    setAddLoginError('');
    setActionError('');
    try {
      const res = await fetch(`/api/admin/users/${user.id}/logins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: addLoginForm.provider,
          providerUserId: addLoginForm.providerUserId.trim(),
          providerEmail: addLoginForm.providerEmail.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setShowAddLogin(false);
      setAddLoginForm({ provider: 'google', providerUserId: '', providerEmail: '' });
      await refresh();
    } catch (err: any) {
      setAddLoginError(err.message ?? 'Add login failed');
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Derived state helpers
  // -------------------------------------------------------------------------

  function hasActiveWorkspace(): boolean {
    return (user?.externalAccounts ?? []).some(
      (a) => a.type === 'workspace' && a.status === 'active',
    );
  }

  function hasClaudeAccount(): boolean {
    return (user?.externalAccounts ?? []).some((a) => a.type === 'claude');
  }

  function provisionClaudeDisabledReason(): string | null {
    if (hasClaudeAccount()) return 'Claude account already exists';
    if (!hasActiveWorkspace()) return 'No active workspace account';
    return null;
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) return <p style={loadingStyle}>Loading user...</p>;
  if (pageError) return <p style={errorStyle}>{pageError}</p>;
  if (!user) return null;

  const isStudent = user.role === 'student';
  const disabledReason = provisionClaudeDisabledReason();

  return (
    <div>
      {/* Back link */}
      <button style={backButtonStyle} onClick={() => navigate('/admin/users')}>
        ← Back to Users
      </button>

      {/* Page-level action error */}
      {actionError && (
        <div style={actionErrorStyle} role="alert">
          <strong>Error: </strong>
          <span style={{ whiteSpace: 'pre-wrap' }}>{actionError}</span>
          <button
            style={dismissButtonStyle}
            onClick={() => setActionError('')}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* User identity                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section style={sectionStyle}>
        <h2 style={headingStyle}>User Details</h2>
        <dl style={dlStyle}>
          <dt style={dtStyle}>Email</dt>
          <dd style={ddStyle}>{user.email}</dd>

          <dt style={dtStyle}>Display Name</dt>
          <dd style={ddStyle}>{user.displayName ?? <em style={{ color: '#94a3b8' }}>none</em>}</dd>

          <dt style={dtStyle}>Role</dt>
          <dd style={ddStyle}>
            <span style={roleBadgeStyle(user.role)}>{user.role}</span>
          </dd>

          <dt style={dtStyle}>Cohort</dt>
          <dd style={ddStyle}>{user.cohort ? user.cohort.name : <em style={{ color: '#94a3b8' }}>unassigned</em>}</dd>

          <dt style={dtStyle}>Joined</dt>
          <dd style={ddStyle}>{new Date(user.createdAt).toLocaleDateString()}</dd>
        </dl>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Logins                                                               */}
      {/* ------------------------------------------------------------------ */}
      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <h3 style={subHeadingStyle}>Logins</h3>
          <button
            style={addButtonStyle}
            disabled={busy}
            onClick={() => { setShowAddLogin((v) => !v); setAddLoginError(''); }}
          >
            {showAddLogin ? 'Cancel' : '+ Add Login'}
          </button>
        </div>

        {showAddLogin && (
          <form onSubmit={handleAddLogin} style={addLoginFormStyle}>
            <label style={labelStyle}>
              Provider
              <select
                value={addLoginForm.provider}
                onChange={(e) => setAddLoginForm((f) => ({ ...f, provider: e.target.value as 'google' | 'github' }))}
                style={inputStyle}
                disabled={busy}
              >
                <option value="google">Google</option>
                <option value="github">GitHub</option>
              </select>
            </label>
            <label style={labelStyle}>
              Provider User ID <span style={{ color: '#dc2626' }}>*</span>
              <input
                type="text"
                value={addLoginForm.providerUserId}
                onChange={(e) => setAddLoginForm((f) => ({ ...f, providerUserId: e.target.value }))}
                placeholder="e.g. 1234567 or google-sub"
                style={inputStyle}
                disabled={busy}
              />
            </label>
            <label style={labelStyle}>
              Provider Email (optional)
              <input
                type="email"
                value={addLoginForm.providerEmail}
                onChange={(e) => setAddLoginForm((f) => ({ ...f, providerEmail: e.target.value }))}
                placeholder="user@example.com"
                style={inputStyle}
                disabled={busy}
              />
            </label>
            {addLoginError && <p style={inlineErrorStyle}>{addLoginError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" style={approveButtonStyle} disabled={busy}>
                {busy ? 'Adding...' : 'Add Login'}
              </button>
              <button
                type="button"
                style={cancelButtonStyle}
                disabled={busy}
                onClick={() => { setShowAddLogin(false); setAddLoginError(''); }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {user.logins.length === 0 ? (
          <p style={emptyStyle}>No logins.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Provider</th>
                <th style={thStyle}>Provider User ID</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Username</th>
                <th style={thStyle}>Added</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {user.logins.map((login) => {
                const isLast = user.logins.length === 1;
                return (
                  <tr key={login.id}>
                    <td style={tdStyle}>{login.provider}</td>
                    <td style={tdStyle}><code style={codeStyle}>{login.providerUserId}</code></td>
                    <td style={tdStyle}>{login.providerEmail ?? <em style={{ color: '#94a3b8' }}>—</em>}</td>
                    <td style={tdStyle}>{login.providerUsername ?? <em style={{ color: '#94a3b8' }}>—</em>}</td>
                    <td style={tdStyle}>{new Date(login.createdAt).toLocaleDateString()}</td>
                    <td style={tdStyle}>
                      <span title={isLast ? 'Cannot remove the last login' : undefined}>
                        <button
                          style={isLast ? disabledButtonStyle : removeButtonStyle}
                          disabled={isLast || busy}
                          onClick={() => handleRemoveLogin(login)}
                        >
                          Remove
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* External Accounts                                                    */}
      {/* ------------------------------------------------------------------ */}
      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <h3 style={subHeadingStyle}>External Accounts</h3>
          {isStudent && (
            <span title={disabledReason ?? undefined}>
              <button
                style={disabledReason ? disabledButtonStyle : provisionButtonStyle}
                disabled={!!disabledReason || busy}
                onClick={handleProvisionClaude}
              >
                {disabledReason
                  ? `Provision Claude Seat (${disabledReason})`
                  : 'Provision Claude Seat'}
              </button>
            </span>
          )}
        </div>

        {user.externalAccounts.length === 0 ? (
          <p style={emptyStyle}>No external accounts.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>External ID</th>
                <th style={thStyle}>Status Changed</th>
                <th style={thStyle}>Scheduled Delete</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {user.externalAccounts.map((account) => {
                const canSuspend = account.status === 'active';
                const canRemove = account.status === 'active' || account.status === 'suspended';
                const isClaude = account.type === 'claude';
                const suspendLabel = isClaude ? 'Suspend (no-op for Claude)' : 'Suspend';

                return (
                  <tr key={account.id}>
                    <td style={tdStyle}>{account.type}</td>
                    <td style={tdStyle}>
                      <span style={statusBadgeStyle(account.status)}>{account.status}</span>
                    </td>
                    <td style={tdStyle}>
                      {account.externalId
                        ? <code style={codeStyle}>{account.externalId}</code>
                        : <em style={{ color: '#94a3b8' }}>—</em>}
                    </td>
                    <td style={tdStyle}>
                      {account.statusChangedAt
                        ? new Date(account.statusChangedAt).toLocaleDateString()
                        : <em style={{ color: '#94a3b8' }}>—</em>}
                    </td>
                    <td style={tdStyle}>
                      {account.scheduledDeleteAt
                        ? new Date(account.scheduledDeleteAt).toLocaleDateString()
                        : <em style={{ color: '#94a3b8' }}>—</em>}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {canSuspend && (
                          <button
                            style={suspendButtonStyle}
                            disabled={busy}
                            onClick={() => handleSuspend(account)}
                            title={isClaude ? 'Suspend is a no-op for Claude accounts (per OQ-003)' : undefined}
                          >
                            {suspendLabel}
                          </button>
                        )}
                        {canRemove && (
                          <span title={account.type === 'workspace' ? 'Will hard-delete the Google Workspace account after 3 days' : undefined}>
                            <button
                              style={removeButtonStyle}
                              disabled={busy}
                              onClick={() => handleRemoveAccount(account)}
                            >
                              Remove
                            </button>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Deprovision Student                                                  */}
      {/* ------------------------------------------------------------------ */}
      {isStudent && (
        <section style={{ ...sectionStyle, borderTop: '2px solid #fecaca', paddingTop: 16, marginTop: 24 }}>
          <h3 style={{ ...subHeadingStyle, color: '#dc2626' }}>Danger Zone</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
            Deprovision removes all active workspace and Claude accounts for this student.
            Pike13 accounts and logins are not affected.
          </p>
          <button
            style={deprovisionButtonStyle}
            disabled={busy}
            onClick={handleDeprovision}
          >
            {busy ? 'Working...' : 'Deprovision Student'}
          </button>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const loadingStyle: React.CSSProperties = { color: '#64748b' };
const errorStyle: React.CSSProperties = { color: '#dc2626' };

const backButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 13,
  background: 'none',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  cursor: 'pointer',
  color: '#475569',
  marginBottom: 20,
};

const actionErrorStyle: React.CSSProperties = {
  background: '#fef2f2',
  border: '1px solid #fca5a5',
  borderRadius: 6,
  padding: '10px 14px',
  marginBottom: 16,
  fontSize: 13,
  color: '#dc2626',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
};

const dismissButtonStyle: React.CSSProperties = {
  marginLeft: 'auto',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
  color: '#dc2626',
  padding: 0,
  flexShrink: 0,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 32,
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 12,
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: 20,
};

const subHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
};

const dlStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '140px 1fr',
  gap: '8px 16px',
  fontSize: 14,
};

const dtStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#64748b',
  fontSize: 13,
};

const ddStyle: React.CSSProperties = {
  margin: 0,
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
  verticalAlign: 'middle',
};

const emptyStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 13,
  fontStyle: 'italic',
};

const codeStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  background: '#f1f5f9',
  padding: '1px 4px',
  borderRadius: 3,
};

const inlineErrorStyle: React.CSSProperties = {
  color: '#dc2626',
  fontSize: 12,
  margin: '4px 0 0',
};

const addLoginFormStyle: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  padding: '16px',
  marginBottom: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxWidth: 480,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
  fontWeight: 600,
  color: '#475569',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 14,
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  fontFamily: 'inherit',
};

function roleBadgeStyle(role: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    admin: { bg: '#fef3c7', color: '#92400e' },
    staff: { bg: '#dbeafe', color: '#1e40af' },
    student: { bg: '#dcfce7', color: '#166534' },
  };
  const c = colors[role] ?? { bg: '#f1f5f9', color: '#475569' };
  return {
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
    background: c.bg,
    color: c.color,
  };
}

function statusBadgeStyle(status: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    active:    { bg: '#dcfce7', color: '#166534' },
    suspended: { bg: '#fef3c7', color: '#92400e' },
    removed:   { bg: '#fee2e2', color: '#991b1b' },
    pending:   { bg: '#f1f5f9', color: '#475569' },
  };
  const c = colors[status] ?? { bg: '#f1f5f9', color: '#475569' };
  return {
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
    background: c.bg,
    color: c.color,
  };
}

const approveButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: '#16a34a',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};

const addButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: '#0ea5e9',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: '#94a3b8',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};

const suspendButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: '#f59e0b',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};

const removeButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: '#dc2626',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};

const disabledButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  background: '#e2e8f0',
  color: '#94a3b8',
  border: 'none',
  borderRadius: 4,
  cursor: 'not-allowed',
  fontWeight: 600,
};

const provisionButtonStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 12,
  background: '#7c3aed',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};

const deprovisionButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  background: '#dc2626',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 700,
};
