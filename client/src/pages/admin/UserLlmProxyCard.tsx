/**
 * UserLlmProxyCard — admin panel for granting / revoking LLM proxy access
 * to a single user (Sprint 013 T005).
 *
 * Rendered inside UserDetailPanel above the external-account cards.
 *
 * Data lifecycle:
 *   GET    /api/admin/users/:id/llm-proxy-token  — current status
 *   POST   /api/admin/users/:id/llm-proxy-token  — grant (returns plaintext once)
 *   DELETE /api/admin/users/:id/llm-proxy-token  — revoke
 *
 * Plaintext-once invariant:
 *   The plaintext token is only present in the response body of the POST.
 *   This component stashes it in local state and displays a "Copy before
 *   leaving this page" banner until the admin dismisses it. The GET endpoint
 *   never returns the plaintext.
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
  // datetime-local wants YYYY-MM-DDTHH:MM (local TZ, no seconds).
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function UserLlmProxyCard({ userId, userName }: Props) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [expiresAtInput, setExpiresAtInput] = useState<string>(
    defaultExpiresAt(),
  );
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
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
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
      const res = await fetch(`/api/admin/users/${userId}/llm-proxy-token`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
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

  if (!status) {
    return (
      <div data-testid="llm-proxy-card" className="user-llm-proxy-card">
        <h3>LLM Proxy</h3>
        {err ? (
          <div className="error" role="alert">
            {err}
          </div>
        ) : (
          <div>Loading…</div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="llm-proxy-card" className="user-llm-proxy-card">
      <h3>LLM Proxy</h3>

      {err && (
        <div className="error" role="alert">
          {err}
        </div>
      )}

      {plaintext && (
        <div
          data-testid="llm-proxy-plaintext"
          className="llm-proxy-plaintext"
          role="status"
        >
          <strong>New token (copy before leaving this page):</strong>
          <code>{plaintext.token}</code>
          <div className="llm-proxy-plaintext-actions">
            <button type="button" onClick={copyPlaintext}>
              Copy
            </button>
            <button type="button" onClick={dismissPlaintext}>
              Dismiss
            </button>
          </div>
          <p className="hint">
            Share this with the student out-of-band. It will not be shown
            again.
          </p>
        </div>
      )}

      {status.enabled ? (
        <div className="llm-proxy-enabled">
          <dl>
            <dt>Usage</dt>
            <dd>
              {status.tokensUsed?.toLocaleString() ?? 0} /{' '}
              {status.tokenLimit?.toLocaleString() ?? 0} tokens
              {' ('}
              {status.requestCount ?? 0} requests{')'}
            </dd>
            <dt>Expires</dt>
            <dd>
              {status.expiresAt
                ? new Date(status.expiresAt).toLocaleString()
                : '—'}
            </dd>
            <dt>Granted</dt>
            <dd>
              {status.grantedAt
                ? new Date(status.grantedAt).toLocaleString()
                : '—'}
            </dd>
          </dl>
          <button
            type="button"
            onClick={submitRevoke}
            disabled={busy}
            className="danger"
          >
            Revoke access
          </button>
        </div>
      ) : (
        <div className="llm-proxy-disabled">
          <p>
            <em>Not enabled.</em> Grant this user an LLM proxy token so
            they can call Claude through the app-hosted forwarder.
          </p>
          {showGrantForm ? (
            <div className="llm-proxy-grant-form">
              <label>
                Expires at{' '}
                <input
                  type="datetime-local"
                  value={expiresAtInput}
                  onChange={(e) => setExpiresAtInput(e.target.value)}
                />
              </label>
              <label>
                Token limit{' '}
                <input
                  type="number"
                  min={1}
                  step={100_000}
                  value={tokenLimitInput}
                  onChange={(e) =>
                    setTokenLimitInput(parseInt(e.target.value, 10) || 0)
                  }
                />
              </label>
              <div className="actions">
                <button
                  type="button"
                  onClick={submitGrant}
                  disabled={busy}
                >
                  Grant access
                </button>
                <button
                  type="button"
                  onClick={() => setShowGrantForm(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowGrantForm(true)}
              disabled={busy}
            >
              Grant access
            </button>
          )}
        </div>
      )}
    </div>
  );
}
