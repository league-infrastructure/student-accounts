/**
 * UserLlmProxyCard — admin panel for granting / revoking LLM proxy access
 * to a single user (Sprint 013 T005).
 *
 * Rendered inside UserDetailPanel next to the external-account cards.
 * Uses the same inline-style vocabulary as the neighboring admin cards
 * (AccountCard / Kv / StatusPill / ActionButton) so it matches visually.
 *
 * Data lifecycle:
 *   GET    /api/admin/users/:id/llm-proxy-token  — current status
 *   POST   /api/admin/users/:id/llm-proxy-token  — grant (returns plaintext once)
 *   DELETE /api/admin/users/:id/llm-proxy-token  — revoke
 *
 * Plaintext-once invariant:
 *   Plaintext is only present in the POST response. We stash it locally
 *   and display a prominent one-shot banner with Copy + Dismiss until
 *   the admin moves on.
 */

import { useCallback, useEffect, useState } from 'react';

interface StatusResponse {
  enabled: boolean;
  tokenId?: number;
  tokensUsed?: number;
  tokenLimit?: number;
  requestCount?: number;
  expiresAt?: string;
  grantedAt?: string;
  grantedBy?: number | null;
  revokedAt?: string | null;
}

interface GrantResponse {
  token: string;
  tokenId: number;
  tokenLimit: number;
  expiresAt: string;
  grantedAt: string;
}

interface Props {
  userId: number;
  userName?: string;
}

/** Default expiration: +30 days, formatted for <input type="datetime-local">. */
function defaultExpiresAt(): string {
  const d = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function UserLlmProxyCard({ userId, userName }: Props) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [expiresAtInput, setExpiresAtInput] = useState<string>(defaultExpiresAt());
  const [tokenLimitInput, setTokenLimitInput] = useState<number>(1_000_000);
  const [plaintext, setPlaintext] = useState<GrantResponse | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/llm-proxy-token`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as StatusResponse;
      setStatus(body);
    } catch (e: any) {
      setErr(e.message ?? 'Failed to load LLM proxy status');
    }
  }, [userId]);

  useEffect(() => {
    if (!Number.isFinite(userId)) return;
    void load();
  }, [userId, load]);

  async function submitGrant() {
    setBusy(true);
    setErr(null);
    try {
      const expiresAt = new Date(expiresAtInput).toISOString();
      const res = await fetch(`/api/admin/users/${userId}/llm-proxy-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expiresAt, tokenLimit: tokenLimitInput }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as GrantResponse;
      setPlaintext(body);
      setShowGrantForm(false);
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Grant failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitRevoke() {
    const msg = `Revoke LLM proxy access for ${userName ?? 'this user'}? Their token will stop working immediately.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/llm-proxy-token`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e: any) {
      setErr(e.message ?? 'Revoke failed');
    } finally {
      setBusy(false);
    }
  }

  async function copyPlaintext() {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext.token);
    } catch {
      // Clipboard API unavailable in some test envs; silently ignore.
    }
  }

  function dismissPlaintext() {
    setPlaintext(null);
  }

  return (
    <section data-testid="llm-proxy-card" style={cardStyle}>
      <h2 style={cardTitleStyle}>LLM Proxy</h2>

      {err && (
        <div role="alert" style={errorStyle}>
          {err}
        </div>
      )}

      {plaintext && (
        <div data-testid="llm-proxy-plaintext" role="status" style={plaintextBannerStyle}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#78350f' }}>
            New token — copy before leaving this page
          </div>
          <code style={plaintextCodeStyle}>{plaintext.token}</code>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={copyPlaintext} style={smallButtonStyle('primary')}>
              Copy
            </button>
            <button type="button" onClick={dismissPlaintext} style={smallButtonStyle('neutral')}>
              Dismiss
            </button>
          </div>
          <div style={hintStyle}>
            Share this with the student out-of-band. It will not be shown again.
          </div>
        </div>
      )}

      {!status ? (
        <div style={{ fontSize: 13, color: '#64748b' }}>Loading…</div>
      ) : status.enabled ? (
        <>
          <Row k="Status" v={<Pill status="enabled" />} />
          <Row
            k="Usage"
            v={
              <span>
                {status.tokensUsed?.toLocaleString() ?? 0} /{' '}
                {status.tokenLimit?.toLocaleString() ?? 0} tokens
                <span style={{ color: '#64748b', marginLeft: 6 }}>
                  ({status.requestCount ?? 0} requests)
                </span>
              </span>
            }
          />
          <Row
            k="Expires"
            v={status.expiresAt ? new Date(status.expiresAt).toLocaleString() : '—'}
          />
          <Row
            k="Granted"
            v={status.grantedAt ? new Date(status.grantedAt).toLocaleString() : '—'}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={submitRevoke}
              disabled={busy}
              style={smallButtonStyle('danger', busy)}
            >
              Revoke access
            </button>
          </div>
        </>
      ) : showGrantForm ? (
        <>
          <div style={{ fontSize: 13, color: '#475569', marginBottom: 10 }}>
            Grant an LLM proxy token so {userName ?? 'this user'} can call Claude
            through the app-hosted forwarder.
          </div>
          <div style={formGridStyle}>
            <label style={labelStyle}>
              <span style={labelTextStyle}>Expires at</span>
              <input
                type="datetime-local"
                value={expiresAtInput}
                onChange={(e) => setExpiresAtInput(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              <span style={labelTextStyle}>Token limit</span>
              <input
                type="number"
                min={1}
                step={100_000}
                value={tokenLimitInput}
                onChange={(e) => setTokenLimitInput(parseInt(e.target.value, 10) || 0)}
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={submitGrant}
              disabled={busy}
              style={smallButtonStyle('primary', busy)}
            >
              Grant access
            </button>
            <button
              type="button"
              onClick={() => setShowGrantForm(false)}
              disabled={busy}
              style={smallButtonStyle('neutral', busy)}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <Row k="Status" v={<Pill status="disabled" />} />
          <div style={{ fontSize: 13, color: '#475569', margin: '8px 0 12px' }}>
            Grant an LLM proxy token so {userName ?? 'this user'} can call Claude
            through the app-hosted forwarder.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setShowGrantForm(true)}
              disabled={busy}
              style={smallButtonStyle('primary', busy)}
            >
              Grant access
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Local components + style primitives (mirrors UserDetailPanel's vocabulary)
// ---------------------------------------------------------------------------

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 4 }}>
      <div style={{ color: '#64748b', minWidth: 100 }}>{k}</div>
      <div style={{ color: '#0f172a' }}>{v}</div>
    </div>
  );
}

function Pill({ status }: { status: 'enabled' | 'disabled' }) {
  const c =
    status === 'enabled'
      ? { bg: '#d1fae5', fg: '#065f46' }
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
      {status}
    </span>
  );
}

function smallButtonStyle(
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
    padding: '7px 14px',
    background: palette.bg,
    color: palette.fg,
    border: palette.border,
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 13,
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

const plaintextBannerStyle: React.CSSProperties = {
  background: '#fef3c7',
  border: '1px solid #fcd34d',
  borderRadius: 6,
  padding: '12px 14px',
  marginBottom: 12,
};

const plaintextCodeStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 13,
  padding: '8px 10px',
  background: '#fffbeb',
  color: '#78350f',
  border: '1px solid #fde68a',
  borderRadius: 4,
  overflowX: 'auto',
  userSelect: 'all',
};

const hintStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: '#92400e',
};

const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 12,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const labelTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: '#fff',
};
