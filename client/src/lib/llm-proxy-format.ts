/**
 * Presentation helpers shared by the student LLM proxy card, the /llm-proxy
 * page and the Account Features row (sprint 003, ticket 004). Pure functions.
 */

/** The subset of GET /api/account/llm-proxy the helpers read. */
export interface LlmProxyFigures {
  enabled: boolean;
  tokensUsed?: number | null;
  tokenLimit?: number | null;
  budgetUsd?: number | null;
  spentUsd?: number | null;
  periodResetsAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
}

export type LlmProxyStatusKind = 'active' | 'expired' | 'revoked' | 'disabled';

/** `$1.50` — two decimals, no thousands grouping surprises for small sums. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** `Nov 1` style short date; `—` for a missing or unparsable value. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * One line of figures: `$0.75 of $5.00 this month · resets Nov 1` when a
 * dollar budget exists, else the legacy `1,000 / 50,000 tokens`.
 */
export function usageLine(f: LlmProxyFigures): string {
  if (f.budgetUsd != null) {
    const spent = formatUsd(f.spentUsd ?? 0);
    const budget = formatUsd(f.budgetUsd);
    const reset = f.periodResetsAt ? ` · resets ${formatShortDate(f.periodResetsAt)}` : '';
    return `${spent} of ${budget} this month${reset}`;
  }
  const used = (f.tokensUsed ?? 0).toLocaleString();
  const limit = (f.tokenLimit ?? 0).toLocaleString();
  return `${used} / ${limit} tokens`;
}

/** 0–100 fill for the usage meter, in dollars when budgeted, else tokens. */
export function usagePercent(f: LlmProxyFigures): number {
  const [used, limit] =
    f.budgetUsd != null ? [f.spentUsd ?? 0, f.budgetUsd] : [f.tokensUsed ?? 0, f.tokenLimit ?? 0];
  if (limit <= 0) return 0;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

/** active / expired / revoked / disabled, from the payload and the clock. */
export function deriveStatus(f: LlmProxyFigures, now: Date = new Date()): LlmProxyStatusKind {
  if (!f.enabled) return 'disabled';
  if (f.revokedAt) return 'revoked';
  if (f.expiresAt) {
    const exp = new Date(f.expiresAt);
    if (!Number.isNaN(exp.getTime()) && exp.getTime() <= now.getTime()) return 'expired';
  }
  return 'active';
}

/** `llmp_abcd…wxyz` — keeps the prefix recognisable, hides the middle. */
export function maskToken(token: string): string {
  if (token.length <= 14) return token;
  return `${token.slice(0, 9)}…${token.slice(-4)}`;
}
