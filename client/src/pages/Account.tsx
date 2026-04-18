import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useProviderStatus } from '../hooks/useProviderStatus';
import { roleBadgeStyle, roleShortLabel } from '../lib/roles';
import { McpSetupContent } from './McpSetup';

const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
  google: 'Google',
  pike13: 'Pike 13',
};

function providerLabel(p: string): string {
  return PROVIDER_LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

function addButtonStyle(provider: string): React.CSSProperties {
  if (provider === 'github') {
    return {
      ...styles.addButton,
      background: '#24292e',
      color: '#fff',
      border: 'none',
    };
  }
  if (provider === 'pike13') {
    return {
      ...styles.addButton,
      background: '#f37121',
      color: '#fff',
      border: 'none',
    };
  }
  // google (white with border)
  return {
    ...styles.addButton,
    background: '#fff',
    color: '#374151',
    border: '1px solid #d1d5db',
  };
}

export default function Account() {
  const { user, refresh } = useAuth();
  const providerStatus = useProviderStatus();
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [mcpOpen, setMcpOpen] = useState(false);

  useEffect(() => {
    if (!mcpOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMcpOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mcpOpen]);

  if (!user) return null;

  const displayName = user.displayName ?? 'User';
  const badge = roleBadgeStyle(user.role);

  const linked = new Set(user.linkedProviders ?? []);
  const configurableButUnlinked = (
    Object.entries(providerStatus) as [string, boolean][]
  )
    .filter(([k, v]) => k !== 'loading' && v === true && !linked.has(k))
    .map(([k]) => k);

  async function handleUnlink(provider: string) {
    setUnlinking(provider);
    setUnlinkError(null);
    try {
      const res = await fetch(`/api/auth/unlink/${provider}`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setUnlinkError((body as { error?: string }).error ?? 'Failed to unlink provider');
      } else {
        await refresh();
      }
    } catch {
      setUnlinkError('Network error');
    } finally {
      setUnlinking(null);
    }
  }

  const linkedProviders = user.linkedProviders ?? [];

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Account</h1>

      <div style={styles.card}>
        <div style={styles.avatarRow}>
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt={displayName} style={styles.avatar} />
          ) : (
            <div style={styles.avatarFallback}>
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div style={styles.name}>{displayName}</div>
            <div style={styles.email}>{user.email}</div>
          </div>
        </div>

        <div style={styles.fields}>
          <Field label="Role">
            <span style={{
              fontSize: 12,
              padding: '2px 8px',
              borderRadius: 9999,
              fontWeight: 600,
              background: badge.background,
              color: badge.color,
            }}>
              {roleShortLabel(user.role)}
            </span>
          </Field>
          {user.provider && <Field label="Auth provider">{user.provider}</Field>}
          <Field label="Member since">
            {new Date(user.createdAt).toLocaleDateString()}
          </Field>
        </div>
      </div>

      <div style={{ ...styles.card, marginTop: '1rem' }}>
        <h2 style={styles.sectionTitle}>Sign-in methods</h2>

        {linkedProviders.length === 0 && (
          <p style={styles.empty}>No OAuth providers linked.</p>
        )}

        {linkedProviders.map((provider) => (
          <div key={provider} style={styles.providerRow}>
            <span style={styles.providerName}>{providerLabel(provider)}</span>
            <button
              onClick={() => handleUnlink(provider)}
              disabled={linkedProviders.length <= 1 || unlinking === provider}
              style={styles.unlinkButton}
              aria-label={`Unlink ${providerLabel(provider)}`}
            >
              {unlinking === provider ? 'Unlinking\u2026' : 'Unlink'}
            </button>
          </div>
        ))}

        {unlinkError && <p role="alert" style={styles.error}>{unlinkError}</p>}

        {!providerStatus.loading && configurableButUnlinked.length > 0 && (
          <div style={styles.addRow}>
            {configurableButUnlinked.map((provider) => (
              <a
                key={provider}
                href={`/api/auth/${provider}?link=1`}
                style={addButtonStyle(provider)}
              >
                Add {providerLabel(provider)}
              </a>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...styles.card, marginTop: '1rem' }}>
        <h2 style={styles.sectionTitle}>MCP Setup</h2>
        <button
          type="button"
          onClick={() => setMcpOpen(true)}
          style={styles.mcpLink}
        >
          Show MCP connection instructions
        </button>
      </div>

      {mcpOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="MCP Setup"
          style={styles.modalBackdrop}
          onClick={() => setMcpOpen(false)}
        >
          <div
            style={styles.modalPanel}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>MCP Setup</h2>
              <button
                type="button"
                onClick={() => setMcpOpen(false)}
                aria-label="Close"
                style={styles.modalClose}
              >
                &times;
              </button>
            </div>
            <div style={styles.modalBody}>
              <McpSetupContent />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <span style={styles.fieldValue}>{children}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 600,
    margin: '40px auto',
    padding: '0 1rem',
  },
  title: {
    fontSize: '1.5rem',
    marginBottom: '1.5rem',
    color: '#1e293b',
  },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '1.5rem',
    background: '#fff',
  },
  avatarRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: '1.5rem',
    paddingBottom: '1.5rem',
    borderBottom: '1px solid #e2e8f0',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    objectFit: 'cover' as const,
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: '#4f46e5',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    fontWeight: 600,
    flexShrink: 0,
  },
  name: {
    fontSize: '1.15rem',
    fontWeight: 600,
    color: '#1e293b',
  },
  email: {
    fontSize: '0.9rem',
    color: '#64748b',
    marginTop: 2,
  },
  fields: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  field: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fieldLabel: {
    fontSize: '0.9rem',
    color: '#64748b',
  },
  fieldValue: {
    fontSize: '0.9rem',
    color: '#1e293b',
    fontWeight: 500,
  },
  // Sign-in methods section
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: '1rem',
    marginTop: 0,
  },
  providerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
  },
  providerName: {
    fontSize: '0.9rem',
    color: '#1e293b',
  },
  unlinkButton: {
    fontSize: '0.8rem',
    padding: '4px 12px',
    borderRadius: 6,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    color: '#64748b',
    cursor: 'pointer',
  },
  addRow: {
    display: 'flex',
    gap: '0.5rem',
    marginTop: '1rem',
    flexWrap: 'wrap' as const,
  },
  addButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 14px',
    borderRadius: 8,
    fontSize: '0.85rem',
    fontWeight: 600,
    textDecoration: 'none',
    cursor: 'pointer',
  },
  empty: {
    fontSize: '0.85rem',
    color: '#64748b',
  },
  error: {
    fontSize: '0.85rem',
    color: '#dc2626',
    marginTop: '0.5rem',
  },
  mcpLink: {
    background: 'none',
    border: 'none',
    color: '#4f46e5',
    padding: 0,
    fontSize: '0.9rem',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  modalBackdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    zIndex: 400,
    padding: '40px 16px',
    overflowY: 'auto' as const,
  },
  modalPanel: {
    background: '#fff',
    borderRadius: 12,
    width: '100%',
    maxWidth: 720,
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.25)',
    overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 1.25rem',
    borderBottom: '1px solid #e2e8f0',
  },
  modalClose: {
    background: 'none',
    border: 'none',
    fontSize: 28,
    lineHeight: 1,
    color: '#64748b',
    cursor: 'pointer',
    padding: '0 4px',
  },
  modalBody: {
    padding: '1rem 1.25rem 1.25rem',
  },
};
