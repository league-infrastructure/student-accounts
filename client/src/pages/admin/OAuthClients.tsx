/**
 * OAuthClients admin page — /admin/oauth-clients (Sprint 018).
 *
 * Lists registered OAuth client applications. Provides:
 *  - "New OAuth Client" button → form modal → creates client → secret modal.
 *  - Per-row "Rotate" button → rotates secret → secret modal.
 *  - Per-row "Disable" button → confirms → soft-deletes client.
 *
 * Secret is displayed via SecretShownOnceModal exactly once after
 * create or rotate. Not retained in state beyond the modal.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SecretShownOnceModal } from '../../components/SecretShownOnceModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OAuthClientRow {
  id: number;
  client_id: string;
  name: string;
  description: string | null;
  redirect_uris: string[];
  allowed_scopes: string[];
  created_at: string;
  disabled_at: string | null;
}

interface CreateClientBody {
  name: string;
  description?: string;
  redirect_uris: string[];
  allowed_scopes: string[];
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function OAuthClients() {
  const queryClient = useQueryClient();

  // Secret modal — non-null when a secret should be shown.
  const [secretModal, setSecretModal] = useState<{ title: string; secret: string } | null>(null);

  // Create modal state.
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '', redirect_uris: '', allowed_scopes: '' });
  const [formError, setFormError] = useState<string | null>(null);

  // Banner for error feedback outside modals.
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const { data: clients = [], isLoading, error: listError } = useQuery<OAuthClientRow[], Error>({
    queryKey: ['admin', 'oauth-clients'],
    queryFn: () => apiFetch<OAuthClientRow[]>('/api/admin/oauth-clients'),
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const createMutation = useMutation<{ client: OAuthClientRow; client_secret: string }, Error, CreateClientBody>({
    mutationFn: (body) =>
      apiFetch('/api/admin/oauth-clients', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (result) => {
      setShowCreateForm(false);
      setCreateForm({ name: '', description: '', redirect_uris: '', allowed_scopes: '' });
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'oauth-clients'] });
      setSecretModal({ title: 'New Client Secret', secret: result.client_secret });
    },
    onError: (err) => setFormError(err.message),
  });

  const rotateMutation = useMutation<{ client_secret: string }, Error, number>({
    mutationFn: (id) =>
      apiFetch(`/api/admin/oauth-clients/${id}/rotate-secret`, { method: 'POST' }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'oauth-clients'] });
      setSecretModal({ title: 'Rotated Client Secret', secret: result.client_secret });
    },
    onError: (err) => setBanner({ ok: false, msg: `Rotate failed: ${err.message}` }),
  });

  const disableMutation = useMutation<void, Error, number>({
    mutationFn: (id) =>
      apiFetch(`/api/admin/oauth-clients/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'oauth-clients'] });
      setBanner({ ok: true, msg: 'Client disabled.' });
    },
    onError: (err) => setBanner({ ok: false, msg: `Disable failed: ${err.message}` }),
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const name = createForm.name.trim();
    if (!name) { setFormError('Name is required.'); return; }
    const redirect_uris = createForm.redirect_uris
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const allowed_scopes = createForm.allowed_scopes
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    createMutation.mutate({ name, description: createForm.description || undefined, redirect_uris, allowed_scopes });
  }

  function handleRotate(client: OAuthClientRow) {
    if (!window.confirm(`Rotate secret for "${client.name}"? The current secret will stop working immediately.`)) return;
    rotateMutation.mutate(client.id);
  }

  function handleDisable(client: OAuthClientRow) {
    if (!window.confirm(`Disable client "${client.name}"? All tokens issued to this client will be rejected.`)) return;
    disableMutation.mutate(client.id);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isLoading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (listError) return <div style={{ padding: 24, color: '#dc2626' }}>Error: {listError.message}</div>;

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0f172a' }}>OAuth Clients</h1>
        <button onClick={() => setShowCreateForm(true)} style={primaryButtonStyle}>
          + New OAuth Client
        </button>
      </div>

      {/* Banner */}
      {banner && (
        <div style={{ ...bannerStyle, background: banner.ok ? '#dcfce7' : '#fee2e2', color: banner.ok ? '#166534' : '#991b1b' }}>
          {banner.msg}
          <button onClick={() => setBanner(null)} style={bannerCloseStyle}>✕</button>
        </div>
      )}

      {/* Table */}
      {clients.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: 14 }}>No OAuth clients registered yet.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              {['Name', 'Client ID', 'Scopes', 'Redirect URIs', 'Status', 'Created', 'Actions'].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id} style={{ background: client.disabled_at ? '#f8fafc' : '#fff' }}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>{client.name}</div>
                  {client.description && (
                    <div style={{ fontSize: 12, color: '#64748b' }}>{client.description}</div>
                  )}
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: '#475569' }}>
                  {client.client_id}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {client.allowed_scopes.map((s) => (
                      <span key={s} style={scopePillStyle}>{s}</span>
                    ))}
                  </div>
                </td>
                <td style={tdStyle}>
                  {client.redirect_uris.length === 0 ? (
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>none</span>
                  ) : (
                    client.redirect_uris.map((u) => (
                      <div key={u} style={{ fontSize: 12, wordBreak: 'break-all' }}>{u}</div>
                    ))
                  )}
                </td>
                <td style={tdStyle}>
                  {client.disabled_at ? (
                    <span style={disabledPillStyle}>Disabled</span>
                  ) : (
                    <span style={activePillStyle}>Active</span>
                  )}
                </td>
                <td style={{ ...tdStyle, fontSize: 12, color: '#64748b' }}>
                  {new Date(client.created_at).toLocaleDateString()}
                </td>
                <td style={tdStyle}>
                  {!client.disabled_at && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleRotate(client)}
                        style={actionButtonStyle}
                        disabled={rotateMutation.isPending}
                      >
                        Rotate
                      </button>
                      <button
                        onClick={() => handleDisable(client)}
                        style={{ ...actionButtonStyle, borderColor: '#fca5a5', color: '#b91c1c' }}
                        disabled={disableMutation.isPending}
                      >
                        Disable
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create form modal */}
      {showCreateForm && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 18 }}>New OAuth Client</h2>
            {formError && <div style={formErrorStyle}>{formError}</div>}
            <form onSubmit={handleCreateSubmit}>
              <FieldLabel>Name *</FieldLabel>
              <input
                style={inputStyle}
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.currentTarget.value })}
                placeholder="My Integration"
                disabled={createMutation.isPending}
              />
              <FieldLabel>Description</FieldLabel>
              <input
                style={inputStyle}
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.currentTarget.value })}
                placeholder="Optional description"
                disabled={createMutation.isPending}
              />
              <FieldLabel>Allowed Scopes (space-separated)</FieldLabel>
              <input
                style={inputStyle}
                value={createForm.allowed_scopes}
                onChange={(e) => setCreateForm({ ...createForm, allowed_scopes: e.currentTarget.value })}
                placeholder="users:read"
                disabled={createMutation.isPending}
              />
              <FieldLabel>Redirect URIs (one per line)</FieldLabel>
              <textarea
                style={{ ...inputStyle, height: 80, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                value={createForm.redirect_uris}
                onChange={(e) => setCreateForm({ ...createForm, redirect_uris: e.currentTarget.value })}
                placeholder="https://example.com/callback"
                disabled={createMutation.isPending}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => { setShowCreateForm(false); setFormError(null); }}
                  style={cancelButtonStyle}
                  disabled={createMutation.isPending}
                >
                  Cancel
                </button>
                <button type="submit" style={primaryButtonStyle} disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Secret shown-once modal */}
      {secretModal && (
        <SecretShownOnceModal
          title={secretModal.title}
          secret={secretModal.secret}
          label="Client Secret"
          onClose={() => setSecretModal(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 4, marginTop: 14, fontSize: 13, fontWeight: 600, color: '#334155' }}>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 6,
  border: 'none',
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  background: '#f8fafc',
  color: '#334155',
  cursor: 'pointer',
};

const actionButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 4,
  border: '1px solid #cbd5e1',
  background: '#f8fafc',
  color: '#334155',
  cursor: 'pointer',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid #e2e8f0',
  fontWeight: 600,
  color: '#475569',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'top',
};

const activePillStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 9999,
  background: '#dcfce7',
  color: '#166534',
  fontSize: 11,
  fontWeight: 600,
};

const disabledPillStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 9999,
  background: '#f1f5f9',
  color: '#64748b',
  fontSize: 11,
  fontWeight: 600,
};

const scopePillStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 6px',
  borderRadius: 4,
  background: '#e0e7ff',
  color: '#3730a3',
  fontSize: 11,
  fontFamily: 'monospace',
};

const bannerStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 6,
  marginBottom: 16,
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const bannerCloseStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
  color: 'inherit',
  opacity: 0.7,
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};

const modalStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: 24,
  boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
  width: '90%',
  maxWidth: 480,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  boxSizing: 'border-box',
};

const formErrorStyle: React.CSSProperties = {
  padding: 10,
  marginBottom: 14,
  borderRadius: 6,
  background: '#fee2e2',
  color: '#991b1b',
  fontSize: 13,
};
