/**
 * AdminLlmProxyFigures — the admin's view of one student's LLM proxy token
 * (sprint 003, ticket 005), shared by UserLlmProxyCard (on the user detail
 * panel) and UserLlmProxyPage (/admin/users/:id/llm-proxy) so both show the
 * same figures and key controls:
 *
 *   - dollar meter + `$x of $y this month · resets <date>` (token fallback
 *     when the token has no budget), request count
 *   - editable monthly limit → PATCH /api/admin/llm-proxy/tokens/:id + toast
 *   - status line (active / expired / revoked) with expiry and grant dates
 *   - key row: masked, Show / Hide, Copy; optional endpoint row
 *
 * Also exports the data layer (type, query key, fetcher, hook) for
 * GET /api/admin/users/:id/llm-proxy.
 */

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../context/ToastContext';
import {
  deriveStatus,
  formatUsd,
  maskToken,
  usageLine,
  usagePercent,
  type LlmProxyStatusKind,
} from '../../lib/llm-proxy-format';
import { LLM_PROXY_MAX_BUDGET_USD } from '../../components/LlmProxyGrantModal';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** GET /api/admin/users/:id/llm-proxy (ticket 005; superset of the legacy -token shape). */
export interface AdminLlmProxyStatus {
  enabled: boolean;
  /** Server-derived; `disabled` when the user never had a token. */
  status?: LlmProxyStatusKind;
  tokenId?: number;
  /** Full plaintext key. Admins see the whole key, by design. */
  token?: string | null;
  tokenMasked?: string | null;
  tokensUsed?: number;
  tokenLimit?: number;
  requestCount?: number;
  budgetUsd?: number | null;
  spentUsd?: number | null;
  spentUsdTotal?: number | null;
  periodResetsAt?: string | null;
  expiresAt?: string | null;
  grantedAt?: string | null;
  grantedBy?: number | null;
  revokedAt?: string | null;
  /** Proxy base URL (`<origin>/proxy`), derived from the request origin. */
  endpoint?: string;
  anthropicEnabled?: boolean;
  anthropicEndpoint?: string | null;
  models?: string[];
}

/** Nested under ['admin', 'users', …] so the SSE 'users' topic cascades here. */
export function adminLlmProxyQueryKey(userId: number) {
  return ['admin', 'users', userId, 'llm-proxy'] as const;
}

export async function fetchAdminLlmProxyStatus(userId: number): Promise<AdminLlmProxyStatus> {
  const res = await fetch(`/api/admin/users/${userId}/llm-proxy`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<AdminLlmProxyStatus>;
}

export function useAdminLlmProxyStatus(userId: number) {
  return useQuery<AdminLlmProxyStatus>({
    queryKey: adminLlmProxyQueryKey(userId),
    queryFn: () => fetchAdminLlmProxyStatus(userId),
    enabled: Number.isFinite(userId),
  });
}

/** PATCH /api/admin/llm-proxy/tokens/:id { budgetUsd }; throws with the server's message. */
export async function patchTokenBudget(tokenId: number, budgetUsd: number): Promise<void> {
  const res = await fetch(`/api/admin/llm-proxy/tokens/${tokenId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ budgetUsd }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

export const STATUS_LABEL: Record<LlmProxyStatusKind, string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
  disabled: 'Disabled',
};

/** Prefer the server's verdict; fall back to the client-side derivation. */
export function statusKind(s: AdminLlmProxyStatus): LlmProxyStatusKind {
  return s.status ?? deriveStatus(s);
}

// ---------------------------------------------------------------------------
// Figures block
// ---------------------------------------------------------------------------

interface FiguresProps {
  userId: number;
  status: AdminLlmProxyStatus;
  /** Show the endpoint row (the page does; the card stays tight). */
  showEndpoint?: boolean;
}

export default function AdminLlmProxyFigures({ userId, status, showEndpoint = false }: FiguresProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState<'token' | 'endpoint' | null>(null);
  const [limitInput, setLimitInput] = useState<string>(budgetToInput(status.budgetUsd));
  const [saving, setSaving] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);

  // Track the server value when it changes underneath us (another admin,
  // SSE refresh) unless the admin is mid-edit.
  useEffect(() => {
    setLimitInput(budgetToInput(status.budgetUsd));
    setLimitError(null);
  }, [status.budgetUsd, status.tokenId]);

  const kind = statusKind(status);
  const pct = usagePercent(status);
  const parsedLimit = parseLimit(limitInput);
  const dirty = parsedLimit !== (status.budgetUsd ?? null);

  async function copy(what: 'token' | 'endpoint', value: string | null | undefined) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  async function saveLimit() {
    if (status.tokenId == null) return;
    if (parsedLimit == null) {
      setLimitError(`Enter a dollar amount between $0.01 and $${LLM_PROXY_MAX_BUDGET_USD}.`);
      return;
    }
    setSaving(true);
    setLimitError(null);
    try {
      await patchTokenBudget(status.tokenId, parsedLimit);
      showToast(`Monthly limit set to ${formatUsd(parsedLimit)}.`, 'success');
      await queryClient.invalidateQueries({ queryKey: adminLlmProxyQueryKey(userId) });
    } catch (e: any) {
      const msg = e?.message ?? 'Could not save the limit';
      setLimitError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="admin-llm-proxy-figures">
      {/* Usage meter */}
      <Row k="Usage">
        <div
          style={styles.meterBg}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <div style={{ ...styles.meterFill, width: `${pct}%`, background: pct >= 100 ? '#dc2626' : '#2563eb' }} />
        </div>
        <span data-testid="llm-proxy-usage" style={{ fontWeight: 600 }}>
          {usageLine(status)}
        </span>
        {status.requestCount !== undefined && (
          <span style={styles.muted}> · {status.requestCount} requests</span>
        )}
        {status.spentUsdTotal != null && status.budgetUsd != null && (
          <span style={styles.muted}> · {formatUsd(status.spentUsdTotal)} lifetime</span>
        )}
      </Row>

      {/* Monthly limit */}
      <Row k="Monthly limit">
        <span style={styles.inlineForm}>
          <span style={styles.muted}>$</span>
          <input
            type="number"
            step={0.5}
            min={0.01}
            max={LLM_PROXY_MAX_BUDGET_USD}
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && dirty && !saving) void saveLimit();
            }}
            aria-label="Monthly limit (USD)"
            data-testid="llm-proxy-limit-input"
            disabled={saving || status.tokenId == null}
            style={styles.limitInput}
          />
          <button
            type="button"
            onClick={saveLimit}
            disabled={saving || !dirty || status.tokenId == null}
            style={smallButton(saving || !dirty)}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {status.budgetUsd == null && (
            <span style={styles.muted}>legacy token quota; set a dollar limit to switch</span>
          )}
        </span>
        {limitError && (
          <div role="alert" style={styles.inlineError}>
            {limitError}
          </div>
        )}
      </Row>

      {/* Status */}
      <Row k="Status">
        <span data-testid="llm-proxy-status" style={{ ...styles.pill, ...pillColors(kind) }}>
          {STATUS_LABEL[kind]}
        </span>
        {status.expiresAt && (
          <span style={styles.muted}>
            {' '}
            · {kind === 'expired' ? 'expired' : 'expires'} {new Date(status.expiresAt).toLocaleString()}
          </span>
        )}
        {status.grantedAt && (
          <span style={styles.muted}> · granted {new Date(status.grantedAt).toLocaleDateString()}</span>
        )}
      </Row>

      {/* Key */}
      <Row k="Key">
        {status.token ? (
          <span style={styles.inlineForm}>
            <code data-testid="llm-proxy-token" style={styles.code}>
              {showToken ? status.token : (status.tokenMasked ?? maskToken(status.token))}
            </code>
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              style={styles.copyBtn}
              aria-label={showToken ? 'Hide key' : 'Show key'}
            >
              {showToken ? 'Hide' : 'Show'}
            </button>
            <button
              type="button"
              onClick={() => copy('token', status.token)}
              style={styles.copyBtn}
              aria-label="Copy key to clipboard"
            >
              {copied === 'token' ? 'Copied' : 'Copy'}
            </button>
          </span>
        ) : (
          <span style={styles.muted} data-testid="llm-proxy-token-unavailable">
            key unavailable — granted before plaintext storage; re-grant to issue a readable key
          </span>
        )}
      </Row>

      {showEndpoint && status.endpoint && (
        <Row k="Endpoint">
          <span style={styles.inlineForm}>
            <code data-testid="llm-proxy-endpoint" style={styles.code}>
              {status.endpoint}
            </code>
            <button
              type="button"
              onClick={() => copy('endpoint', status.endpoint)}
              style={styles.copyBtn}
              aria-label="Copy endpoint to clipboard"
            >
              {copied === 'endpoint' ? 'Copied' : 'Copy'}
            </button>
          </span>
        </Row>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function budgetToInput(budgetUsd: number | null | undefined): string {
  return budgetUsd == null ? '' : String(budgetUsd);
}

/** Positive dollars up to the server max, else null. */
function parseLimit(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > LLM_PROXY_MAX_BUDGET_USD) return null;
  return n;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div style={styles.row}>
      <div style={styles.rowKey}>{k}</div>
      <div style={styles.rowValue}>{children}</div>
    </div>
  );
}

function pillColors(kind: LlmProxyStatusKind): React.CSSProperties {
  return kind === 'active'
    ? { background: '#d1fae5', color: '#065f46' }
    : kind === 'disabled'
      ? { background: '#e2e8f0', color: '#475569' }
      : { background: '#fee2e2', color: '#991b1b' };
}

export function smallButton(disabled = false): React.CSSProperties {
  return {
    fontSize: 12,
    padding: '3px 10px',
    border: '1px solid #cbd5e1',
    borderRadius: 4,
    background: '#f8fafc',
    color: '#0f172a',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

const styles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', gap: 8, fontSize: 13, marginBottom: 6, alignItems: 'baseline', flexWrap: 'wrap' },
  rowKey: { color: '#64748b', minWidth: 100, flexShrink: 0 },
  rowValue: { color: '#0f172a', minWidth: 0, flex: 1 },
  muted: { color: '#64748b' },
  meterBg: {
    width: '100%',
    maxWidth: 360,
    height: 6,
    background: '#e2e8f0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  meterFill: { height: '100%' },
  inlineForm: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  limitInput: {
    width: 90,
    padding: '3px 8px',
    fontSize: 13,
    border: '1px solid #cbd5e1',
    borderRadius: 4,
    background: '#fff',
  },
  inlineError: { color: '#991b1b', fontSize: 12, marginTop: 4 },
  pill: {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 999,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    padding: '2px 6px',
    background: '#f1f5f9',
    borderRadius: 4,
    userSelect: 'all',
    wordBreak: 'break-all',
  },
  copyBtn: {
    fontSize: 12,
    padding: '2px 8px',
    border: '1px solid #cbd5e1',
    borderRadius: 4,
    background: '#f8fafc',
    cursor: 'pointer',
  },
};
