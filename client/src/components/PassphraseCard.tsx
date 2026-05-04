/**
 * PassphraseCard — inline admin passphrase management widget.
 *
 * Used in both CohortDetailPanel and GroupDetailPanel.
 * Fetches GET /api/admin/<scope>s/:id/passphrase via React Query.
 *   - 404 → empty state: shows "Create passphrase" button.
 *   - Active record → shows plaintext (monospace, selectable), live TTL
 *     countdown, Copy / Regenerate / Revoke buttons, and an LLM-proxy
 *     indicator when grantLlmProxy is true.
 *
 * The live countdown flips the card back to empty state when the TTL
 * expires by invalidating the query (server will then return 404).
 *
 * The SSE topics 'cohorts' and 'groups' already cascade to
 * ['admin', 'cohorts', id, 'passphrase'] / ['admin', 'groups', id, 'passphrase']
 * through useAdminEventStream prefix matching — no extra wiring needed.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PassphraseModal, type PassphraseRecord } from './PassphraseModal';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PassphraseCardProps {
  scopeKind: 'cohort' | 'group';
  scopeId: number;
  scopeName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PassphraseCard({ scopeKind, scopeId, scopeName }: PassphraseCardProps) {
  const queryClient = useQueryClient();
  const queryKey = ['admin', scopeKind === 'cohort' ? 'cohorts' : 'groups', scopeId, 'passphrase'];

  const passphraseQuery = useQuery<PassphraseRecord | null>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/admin/${scopeKind}s/${scopeId}/passphrase`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: Number.isFinite(scopeId),
  });

  // Rotate (or create-on-first-use) — same POST endpoint with default
  // settings. Used by both Regenerate buttons (passphrase + invite URL)
  // and by the auto-create effect below.
  const rotateMutation = useMutation<PassphraseRecord, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/${scopeKind}s/${scopeId}/passphrase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grantLlmProxy: false }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const revokeMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/${scopeKind}s/${scopeId}/passphrase`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [copied, setCopied] = useState<'passphrase' | 'url' | null>(null);

  const record = passphraseQuery.data ?? null;

  // Auto-create on first load: if the GET returned null (no active
  // passphrase), kick off a POST so the card renders the live values
  // immediately instead of an empty "Create passphrase" state.
  useEffect(() => {
    if (
      !passphraseQuery.isLoading &&
      !passphraseQuery.isError &&
      record === null &&
      !rotateMutation.isPending &&
      !rotateMutation.isError
    ) {
      rotateMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passphraseQuery.isLoading, passphraseQuery.isError, record]);

  // Invitation URL — bare /login link the admin shares; students enter
  // the passphrase shown above. Includes the passphrase as a query
  // hint that the Login page may consume in the future.
  const inviteUrl = record
    ? `${window.location.origin}/login?passphrase=${encodeURIComponent(record.plaintext)}`
    : '';

  // Live TTL countdown — re-runs whenever record changes or scopeId changes
  useEffect(() => {
    if (!record) {
      setCountdown('');
      return;
    }
    const expiresAtMs = new Date(record.expiresAt).getTime();

    function tick() {
      const remaining = Math.max(0, expiresAtMs - Date.now());
      if (remaining === 0) {
        setCountdown('expired');
        queryClient.invalidateQueries({ queryKey });
        return;
      }
      const totalSeconds = Math.floor(remaining / 1000);
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      setCountdown(`${mins}m ${secs}s`);
    }

    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, scopeId]);

  async function handleCopy(which: 'passphrase' | 'url') {
    if (!record) return;
    const text = which === 'passphrase' ? record.plaintext : inviteUrl;
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleRevoke() {
    if (!record) return;
    if (
      !confirm(
        `Revoke the passphrase for ${scopeName}? Students who already signed up keep their accounts; only new signups are blocked.`,
      )
    )
      return;
    revokeMutation.mutate();
  }

  function handleCreated() {
    queryClient.invalidateQueries({ queryKey });
    setModalOpen(false);
  }

  if (passphraseQuery.isLoading) {
    return (
      <div style={cardStyle}>
        <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Loading passphrase…</p>
      </div>
    );
  }

  if (passphraseQuery.isError) {
    return (
      <div style={cardStyle}>
        <p style={{ margin: 0, fontSize: 13, color: '#dc2626' }}>
          Error loading passphrase: {(passphraseQuery.error as Error).message}
        </p>
      </div>
    );
  }

  // Empty state while the auto-create POST is in flight (or null + about to fire).
  if (!record) {
    return (
      <div style={cardStyle}>
        <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
          {rotateMutation.isError
            ? `Failed to create passphrase: ${rotateMutation.error.message}`
            : 'Generating passphrase…'}
        </p>
      </div>
    );
  }

  return (
    <>
      <div style={cardStyle}>
        {/* Single horizontal row: passphrase value + copy icon, URL value +
            copy icon, one shared Regenerate, expires, revoke. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={labelStyle}>Passphrase</span>
          <code style={valueStyle}>{record.plaintext}</code>
          <CopyIconButton
            ariaLabel="Copy passphrase"
            copied={copied === 'passphrase'}
            onClick={() => handleCopy('passphrase')}
          />

          <span style={{ ...labelStyle, marginLeft: 8 }}>Invitation URL</span>
          <code style={{ ...valueStyle, fontSize: 12 }}>{inviteUrl}</code>
          <CopyIconButton
            ariaLabel="Copy invitation URL"
            copied={copied === 'url'}
            onClick={() => handleCopy('url')}
          />

          <button
            type="button"
            onClick={() => rotateMutation.mutate()}
            disabled={rotateMutation.isPending}
            style={smBtn}
            title="Regenerate the passphrase (also rotates the invitation URL)"
          >
            {rotateMutation.isPending ? 'Rotating…' : 'Regenerate'}
          </button>

          <span
            style={{
              fontSize: 12,
              marginLeft: 8,
              color: countdown === 'expired' ? '#dc2626' : '#64748b',
            }}
          >
            {countdown === 'expired' ? 'Expired' : `Expires in ${countdown}`}
          </span>
          {record.grantLlmProxy && (
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                background: '#dbeafe',
                color: '#1e40af',
                borderRadius: 999,
                fontWeight: 600,
              }}
            >
              ✓ LLM proxy
            </span>
          )}
          <button
            type="button"
            onClick={handleRevoke}
            disabled={revokeMutation.isPending}
            style={smDangerBtn}
          >
            {revokeMutation.isPending ? 'Revoking…' : 'Revoke'}
          </button>
        </div>

        {revokeMutation.isError && (
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#dc2626' }}>
            Revoke failed: {(revokeMutation.error as Error).message}
          </p>
        )}
        {rotateMutation.isError && (
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#dc2626' }}>
            Regenerate failed: {(rotateMutation.error as Error).message}
          </p>
        )}
      </div>

      <PassphraseModal
        isOpen={modalOpen}
        scope={{ kind: scopeKind, id: scopeId, name: scopeName }}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// CopyIconButton — small clipboard glyph button. Flips to a check mark
// for ~2s after a successful copy.
// ---------------------------------------------------------------------------

function CopyIconButton({
  ariaLabel,
  copied,
  onClick,
}: {
  ariaLabel: string;
  copied: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={iconBtnStyle}
      aria-label={ariaLabel}
      title={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12l5 5L20 7" stroke="#15803d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" stroke="#475569" strokeWidth="1.8" />
          <path
            d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
            stroke="#475569"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  marginBottom: 16,
  padding: 12,
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  fontSize: 13,
  color: '#475569',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#334155',
};

const valueStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 13,
  background: '#f1f5f9',
  padding: '4px 10px',
  borderRadius: 4,
  userSelect: 'text',
  letterSpacing: '0.03em',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 360,
};

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 4,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 4,
};

const smBtn: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  background: '#f8fafc',
  color: '#334155',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  cursor: 'pointer',
};

const smDangerBtn: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  background: '#fee2e2',
  color: '#dc2626',
  border: '1px solid #fecaca',
  borderRadius: 4,
  cursor: 'pointer',
};
