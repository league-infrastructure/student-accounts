/**
 * AdminUsersPanel — /admin/users.
 *
 * League staff accounts (anything on a `*.jointheleague.org` domain
 * except `@students.*`). This is the ONLY place where an admin can
 * flip another user's admin bit. Guards:
 *   - self-demote is blocked (server 403, button disabled client-side)
 *   - demoting the final admin is blocked (server 409, button disabled
 *     client-side)
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isStaffLeagueEmail } from '../../lib/email-domain';
import { useAuth } from '../../context/AuthContext';

interface AdminUser {
  id: number;
  email: string;
  displayName: string | null;
  role: string; // 'ADMIN' | 'STAFF' | 'USER' (legacy serialization)
  createdAt: string;
}

async function fetchUsers(): Promise<AdminUser[]> {
  const res = await fetch('/api/admin/users');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

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

export default function AdminUsersPanel() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const { data: users, isLoading, error } = useQuery<AdminUser[], Error>({
    queryKey: ['admin', 'users'],
    queryFn: fetchUsers,
  });

  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);

  const mutation = useMutation<void, Error, { id: number; role: 'admin' | 'staff' }>({
    mutationFn: ({ id, role }) => setRole(id, role),
    onSuccess: () => {
      setBanner(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => setBanner({ ok: false, msg: err.message }),
  });

  const staff = useMemo(
    () => (users ?? []).filter((u) => isStaffLeagueEmail(u.email)),
    [users],
  );

  const adminCount = staff.filter((u) => u.role === 'ADMIN').length;

  if (isLoading) return <p style={{ color: '#64748b' }}>Loading…</p>;
  if (error) return <p style={{ color: '#dc2626' }}>{error.message}</p>;

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>League accounts</h2>
      <p style={{ color: '#64748b', marginTop: 0, fontSize: 13 }}>
        Staff and admins signed in with a League Google account. This page
        is the only way to grant or remove admin privileges.
      </p>

      {banner && (
        <div
          role="alert"
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

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={th}>Name</th>
            <th style={th}>Email</th>
            <th style={th}>Role</th>
            <th style={{ ...th, textAlign: 'right' }}>Admin</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((u) => {
            const isAdmin = u.role === 'ADMIN';
            const isSelf = currentUser?.id === u.id;
            const isLastAdmin = isAdmin && adminCount === 1;
            const disabled =
              mutation.isPending || isSelf || (isAdmin && isLastAdmin);

            const title = isSelf
              ? 'You cannot change your own admin status.'
              : isLastAdmin
                ? 'Cannot demote the last remaining admin.'
                : isAdmin
                  ? 'Remove admin access.'
                  : 'Grant admin access.';

            return (
              <tr key={u.id}>
                <td style={td}>
                  <Link to={`/users/${u.id}`} style={linkStyle}>
                    {u.displayName || u.email}
                  </Link>
                </td>
                <td style={td}>{u.email}</td>
                <td style={td}>
                  <RolePill role={u.role} />
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button
                    type="button"
                    disabled={disabled}
                    title={title}
                    onClick={() =>
                      mutation.mutate({
                        id: u.id,
                        role: isAdmin ? 'staff' : 'admin',
                      })
                    }
                    style={buttonStyle(isAdmin, disabled)}
                  >
                    {isAdmin ? 'Remove admin' : 'Make admin'}
                  </button>
                </td>
              </tr>
            );
          })}
          {staff.length === 0 && (
            <tr>
              <td colSpan={4} style={{ ...td, color: '#94a3b8', textAlign: 'center' }}>
                No League staff accounts yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RolePill({ role }: { role: string }) {
  const c =
    role === 'ADMIN'
      ? { bg: '#ede9fe', fg: '#5b21b6' }
      : role === 'STAFF'
        ? { bg: '#e0f2fe', fg: '#075985' }
        : { bg: '#e2e8f0', fg: '#475569' };
  return (
    <span
      style={{
        fontSize: 11,
        padding: '2px 8px',
        background: c.bg,
        color: c.fg,
        borderRadius: 999,
        fontWeight: 600,
      }}
    >
      {role}
    </span>
  );
}

function buttonStyle(isAdmin: boolean, disabled: boolean): React.CSSProperties {
  const bg = disabled ? '#cbd5e1' : isAdmin ? '#dc2626' : '#2563eb';
  return {
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 600,
    background: bg,
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
const linkStyle: React.CSSProperties = { color: '#2563eb', textDecoration: 'none', fontWeight: 600 };
