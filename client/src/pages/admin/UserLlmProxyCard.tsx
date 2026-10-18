/**
 * UserLlmProxyCard — the admin "LLM Proxy" card on a user's detail panel
 * (sprint 003, ticket 005; originally Sprint 013 T005).
 *
 * Compact: the shared AdminLlmProxyFigures block (dollar meter, editable
 * monthly limit, status, masked key with Show / Copy), then the actions:
 * "Open LLM page" (/admin/users/:id/llm-proxy — setup examples with this
 * student's key and the recent-requests table), "OpenRouter activity"
 * (account-wide upstream usage; per-student detail is in our own log) and
 * Grant / Revoke. Grant opens LlmProxyGrantModal, whose budget defaults to
 * the server's $5.
 *
 * Data lifecycle:
 *   GET    /api/admin/users/:id/llm-proxy        — status (full key, dollars)
 *   POST   /api/admin/users/:id/llm-proxy-token  — grant { expiresAt, budgetUsd, tokenLimit? }
 *   DELETE /api/admin/users/:id/llm-proxy-token  — revoke
 *   PATCH  /api/admin/llm-proxy/tokens/:id       — { budgetUsd } (inside the figures block)
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { LlmProxyGrantModal } from '../../components/LlmProxyGrantModal';
import AdminLlmProxyFigures, {
  adminLlmProxyQueryKey,
  STATUS_LABEL,
  statusKind,
  useAdminLlmProxyStatus,
} from './AdminLlmProxyFigures';

export const OPENROUTER_ACTIVITY_URL = 'https://openrouter.ai/activity';

interface Props {
  userId: number;
  userName?: string;
}

export default function UserLlmProxyCard({ userId, userName }: Props) {
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);

  const { data: status, error: queryError } = useAdminLlmProxyStatus(userId);

  const err = mutationError ?? (queryError ? (queryError as Error).message : null);

  const refetchStatus = () =>
    queryClient.invalidateQueries({ queryKey: adminLlmProxyQueryKey(userId) });

  async function submitGrant(expiresAtRaw: string, budgetUsd: number, tokenLimit?: number) {
    setBusy(true);
    setMutationError(null);
    try {
      const expires = new Date(expiresAtRaw);
      if (Number.isNaN(expires.getTime())) {
        throw new Error('Expiration must be a valid ISO 8601 date/time.');
      }
      const res = await fetch(`/api/admin/users/${userId}/llm-proxy-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expiresAt: expires.toISOString(),
          budgetUsd,
          ...(tokenLimit !== undefined ? { tokenLimit } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      // The status refetch carries the key; nothing to keep from this body.
      await res.json().catch(() => null);
      setGrantOpen(false);
      await refetchStatus();
    } catch (e: any) {
      setMutationError(e.message ?? 'Grant failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitRevoke() {
    const msg = `Revoke LLM proxy access for ${userName ?? 'this user'}? Their key will stop working immediately.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    setMutationError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/llm-proxy-token`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      await refetchStatus();
    } catch (e: any) {
      setMutationError(e.message ?? 'Revoke failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="llm-proxy-card" style={cardStyle}>
      <h2 style={cardTitleStyle}>LLM Proxy</h2>

      {err && (
        <div role="alert" style={errorStyle}>
          {err}
        </div>
      )}

      {!status ? (
        <div style={{ fontSize: 13, color: '#64748b' }}>Loading…</div>
      ) : status.enabled ? (
        <>
          <AdminLlmProxyFigures userId={userId} status={status} />
          <div style={actionsStyle}>
            <Link
              to={`/admin/users/${userId}/llm-proxy`}
              style={buttonStyle('primary')}
              data-testid="llm-proxy-open-page"
            >
              Open LLM page
            </Link>
            <OpenRouterLink />
            <button
              type="button"
              onClick={submitRevoke}
              disabled={busy}
              style={buttonStyle('danger', busy)}
            >
              Revoke access
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 6, alignItems: 'baseline' }}>
            <div style={{ color: '#64748b', minWidth: 100 }}>Status</div>
            <span data-testid="llm-proxy-status" style={inactivePillStyle}>
              {STATUS_LABEL[statusKind(status)]}
            </span>
            {status.revokedAt && (
              <span style={{ color: '#64748b' }}>
                revoked {new Date(status.revokedAt).toLocaleDateString()}
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: '#475569', margin: '8px 0 12px' }}>
            Grant an LLM proxy key so {userName ?? 'this user'} can use Claude Code, Continue
            and other tools through the League proxy. New keys get the default monthly budget
            ($5) unless you change it.
          </div>
          <div style={actionsStyle}>
            <button
              type="button"
              onClick={() => setGrantOpen(true)}
              disabled={busy}
              style={buttonStyle('primary', busy)}
            >
              Grant access
            </button>
            <OpenRouterLink />
          </div>
          <LlmProxyGrantModal
            isOpen={grantOpen}
            onCancel={() => setGrantOpen(false)}
            onConfirm={(expiresAt, budgetUsd, tokenLimit) => {
              void submitGrant(expiresAt, budgetUsd, tokenLimit);
            }}
            isLoading={busy}
            defaultBudgetUsd={5}
          />
        </>
      )}
    </section>
  );
}

/** External link to OpenRouter's activity page — the whole League account, not one student. */
export function OpenRouterLink() {
  return (
    <a
      href={OPENROUTER_ACTIVITY_URL}
      target="_blank"
      rel="noopener noreferrer"
      style={buttonStyle('neutral')}
      title="OpenRouter usage for the whole League account (all students share one upstream key)"
      data-testid="llm-proxy-openrouter-link"
    >
      OpenRouter activity <span style={{ color: '#64748b', fontWeight: 400 }}>(account-wide)</span> ↗
    </a>
  );
}

// ---------------------------------------------------------------------------
// Styles (mirrors UserDetailPanel's vocabulary)
// ---------------------------------------------------------------------------

function buttonStyle(
  variant: 'primary' | 'danger' | 'neutral',
  disabled = false,
): React.CSSProperties {
  const palette =
    variant === 'primary'
      ? { bg: '#2563eb', fg: '#fff', border: 'none' }
      : variant === 'danger'
        ? { bg: '#dc2626', fg: '#fff', border: 'none' }
        : { bg: '#f1f5f9', fg: '#0f172a', border: '1px solid #cbd5e1' };
  return {
    display: 'inline-block',
    padding: '7px 14px',
    background: palette.bg,
    color: palette.fg,
    border: palette.border,
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 13,
    textDecoration: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

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

const errorStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#991b1b',
  background: '#fee2e2',
  border: '1px solid #fecaca',
  padding: '8px 10px',
  borderRadius: 6,
  marginBottom: 10,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 12,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const inactivePillStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  background: '#e2e8f0',
  color: '#475569',
  borderRadius: 999,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};
