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
  const [copied, setCopied] = useState(false);

  const record = passphraseQuery.data ?? null;

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

  async function handleCopy() {
    if (!record) return;
    await navigator.clipboard.writeText(record.plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  return (
    <>
      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: record ? 10 : 0,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Passphrase</span>
          {!record && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              style={createPassphraseBtn}
            >
              Create passphrase
            </button>
          )}
        </div>

        {record && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <code
                style={{
                  fontFamily: 'monospace',
                  fontSize: 15,
                  background: '#f1f5f9',
                  padding: '4px 10px',
                  borderRadius: 4,
                  userSelect: 'text',
                  letterSpacing: '0.03em',
                }}
              >
                {record.plaintext}
              </code>
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
                  ✓ Includes LLM proxy
                </span>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                marginTop: 8,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: countdown === 'expired' ? '#dc2626' : '#64748b',
                }}
              >
                {countdown === 'expired' ? 'Expired' : `Expires in ${countdown}`}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={handleCopy} style={smBtn}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button type="button" onClick={() => setModalOpen(true)} style={smBtn}>
                  Regenerate
                </button>
                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={revokeMutation.isPending}
                  style={smDangerBtn}
                >
                  {revokeMutation.isPending ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            </div>

            {revokeMutation.isError && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#dc2626' }}>
                Revoke failed: {(revokeMutation.error as Error).message}
              </p>
            )}
          </>
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

const createPassphraseBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 13,
  fontWeight: 600,
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
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
