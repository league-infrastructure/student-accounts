/**
 * LlmProxyTokenService — domain logic for the LlmProxyToken entity (Sprint 013;
 * monthly dollar budgets added in sprint 003).
 *
 * Responsibilities:
 *  - Grant a new token: generate an opaque random string, hash it (SHA-256),
 *    persist the hash, the plaintext and metadata (expiry, legacy token limit,
 *    monthly dollar budget, period start), return the plaintext.
 *  - Revoke the active token for a user.
 *  - Validate a bearer token on the proxy hot path: hash lookup, revocation
 *    check, expiration check, lazy monthly period roll, budget cut-off.
 *  - Record usage after a forwarded call: token counters, dollars spent this
 *    period and lifetime, and one LlmProxyRequest row.
 *  - Budget administration: set a token's budget (audited) and backfill the
 *    default budget onto tokens granted before budgets existed.
 *  - Audit-event recording in the same transaction as the mutation
 *    (AuditService invariant).
 *
 * Budget model (sprint 003):
 *  - `budget_usd` is the cap for one UTC calendar month. `spent_usd` is the
 *    spend inside the period that started at `period_start` (always the first
 *    instant of a UTC month). The period is rolled lazily: `assertUsable`
 *    runs on every authenticated request and, when `period_start` is missing
 *    or before the current month, zeroes `spent_usd` and stamps the new
 *    start. No scheduler is involved, and the semantics match OpenRouter's
 *    midnight-UTC accounting.
 *  - While `budget_usd` is NULL (rows from before the migration, until the
 *    admin backfill) the legacy `tokens_used >= token_limit` check applies so
 *    existing tokens keep behaving.
 *  - Cost per request comes from the forwarder (OpenRouter's `usage.cost`);
 *    when absent, `TierPricing` estimates it so accounting never records
 *    zero.
 *
 * Errors thrown:
 *  - ConflictError (409) — a user already has an active token at grant time.
 *  - NotFoundError (404) — user has no active token to revoke; unknown token
 *    id on setBudget.
 *  - ValidationError (400) — budget outside (0, LLM_PROXY_MAX_BUDGET_USD].
 *  - LlmProxyTokenUnauthorizedError (401) — bearer is missing, unknown,
 *    revoked, or expired.
 *  - LlmProxyTokenQuotaExceededError (429) — monthly budget reached (or the
 *    legacy token quota exhausted).
 *
 * Storage of the plaintext:
 *  - The plaintext IS persisted, in `LlmProxyToken.token_plaintext`, next to
 *    the SHA-256 hash that the proxy hot path looks up. It is stored so the
 *    student can read their token again on the Account page and so the League
 *    laptops can fetch the same token at every login through
 *    POST /api/fleet/llm-token (`ensureActive`) instead of minting a new one
 *    each time. These tokens are quota-capped, expire, and are scoped to
 *    classroom use, so the trade-off is deliberate. Rows created before the
 *    column existed have NULL and get a fresh token on the next `ensureActive`.
 *    Validation still uses only `token_hash`.
 *  - The token format is `llmp_<base64url(randomBytes(32))>`. The prefix
 *    aids identification in logs/pastes and does not affect validation.
 */

import { randomBytes, createHash } from 'node:crypto';

import { AppError, ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { createLogger } from './logger.js';
import { getConfig } from './config.js';
import type { AuditService } from './audit.service.js';
import { LlmProxyTokenRepository } from './repositories/llm-proxy-token.repository.js';
import { TierPricing, type ConfigReader } from './llm-proxy-pricing.js';
import type { LlmProxyToken } from '../generated/prisma/client.js';

const logger = createLogger('llm-proxy-token-service');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Random bytes that seed the opaque part of the token. */
export const TOKEN_BYTES = 32;

/** Prefix stamped on every plaintext token — helps pattern-match in logs. */
export const TOKEN_PREFIX = 'llmp_';

/** Token limit used wherever a grant is made without an explicit limit. */
export const LLM_PROXY_DEFAULT_TOKEN_LIMIT = 1_000_000;

/** Lifetime of tokens minted automatically (reconcile, fleet auto-grant). */
export const LLM_PROXY_AUTO_GRANT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Budget used when LLM_PROXY_DEFAULT_BUDGET_USD is unset or unparseable.
 * Mirrors the key's `defaultValue` in CONFIG_KEYS.
 */
export const LLM_PROXY_FALLBACK_BUDGET_USD = 5;

/** Largest monthly budget an admin may set on one token. */
export const LLM_PROXY_MAX_BUDGET_USD = 1000;

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a bearer token is missing, unknown, revoked, or expired.
 * The route layer translates this to HTTP 401.
 */
export class LlmProxyTokenUnauthorizedError extends AppError {
  constructor(message = 'Invalid or revoked LLM proxy token') {
    super(message, 401);
    this.name = 'LlmProxyTokenUnauthorizedError';
  }
}

/**
 * Thrown when a token's monthly budget is reached (`spent_usd >= budget_usd`)
 * or, for tokens without a budget, the legacy token quota is exhausted
 * (`tokens_used >= token_limit`). The route layer translates this to HTTP 429.
 */
export class LlmProxyTokenQuotaExceededError extends AppError {
  constructor(message = 'LLM proxy token quota exhausted') {
    super(message, 429);
    this.name = 'LlmProxyTokenQuotaExceededError';
  }
}

// ---------------------------------------------------------------------------
// Public option types
// ---------------------------------------------------------------------------

export type GrantParams = {
  expiresAt: Date;
  /** Legacy token-count quota; defaults to LLM_PROXY_DEFAULT_TOKEN_LIMIT. */
  tokenLimit?: number;
  /** Monthly dollar budget; defaults to LLM_PROXY_DEFAULT_BUDGET_USD. */
  budgetUsd?: number;
};

export type GrantOptions = {
  /** Origin of the grant — feeds the audit event `details` blob. */
  scope?: 'single' | 'cohort' | 'group' | 'reconcile' | 'fleet';
  scopeId?: number | null;
  /**
   * @deprecated No longer enforced. The Sprint 026 T004 permission gate
   * (refuse to grant unless the user was "allowed") was removed — admins may
   * grant LLM proxy to any user. `allows_llm_proxy` is now kept in lockstep
   * with token existence by `grant`/`revoke` themselves, so it is the single
   * source of truth rather than a precondition. Retained only so existing
   * callers keep compiling; the value is ignored.
   */
  llmProxyAllowed?: boolean;
};

export type GrantResult = {
  /** Plaintext token. Shown to the caller exactly once. */
  token: string;
  /** Persisted row. */
  row: LlmProxyToken;
};

export type EnsureActiveResult = {
  /** Plaintext token — the stored `token_plaintext` or a freshly minted one. */
  token: string;
  row: LlmProxyToken;
  /** True when this call minted a new token. */
  granted: boolean;
};

/**
 * What the forwarder reports after one proxied call. `costUsd` is
 * OpenRouter's figure when it supplied one; when null/undefined the cost is
 * estimated from TierPricing using `modelSent` (fallback tier MEDIUM).
 */
export type UsageReport = {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number | null;
  /** Model name the client asked for (e.g. "league-small"). */
  modelRequested?: string | null;
  /** OpenRouter slug actually sent upstream. */
  modelSent?: string | null;
  /** Wire protocol of the proxied call; defaults to 'openai'. */
  protocol?: 'openai' | 'anthropic';
  /** Upstream HTTP status; defaults to 200. */
  status?: number;
};

/** Dollar fields shared by every token payload (account, admin, fleet). */
export type BudgetSummary = {
  /** Monthly cap, or null for a legacy token still on the token-count quota. */
  budgetUsd: number | null;
  /** Spend in the period in effect at `now` (0 when the stored period is stale). */
  spentUsd: number;
  /** Lifetime spend. */
  spentUsdTotal: number;
  /** ISO timestamp of the first instant of the next UTC month. */
  periodResetsAt: string;
};

export type LlmProxyTokenServiceOptions = {
  /** Fallback price table; defaults to one reading the live config. */
  pricing?: TierPricing;
  /** Clock; defaults to `() => new Date()`. Tests inject a fixed date. */
  now?: () => Date;
  /** Config lookup for LLM_PROXY_DEFAULT_BUDGET_USD; defaults to getConfig. */
  config?: ConfigReader;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** First instant of the UTC month containing `d`. */
export function utcMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** First instant of the UTC month after the one containing `d`. */
export function utcNextMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/**
 * The configured default monthly budget. Falls back to
 * LLM_PROXY_FALLBACK_BUDGET_USD when the key is unset, non-numeric or not
 * positive, so a bad config value never grants an unbounded token.
 */
export function defaultBudgetUsd(config: ConfigReader = getConfig): number {
  const raw = config('LLM_PROXY_DEFAULT_BUDGET_USD');
  const n = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : LLM_PROXY_FALLBACK_BUDGET_USD;
}

/** True for a budget an admin may set: a finite number in (0, max]. */
export function isValidBudgetUsd(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= LLM_PROXY_MAX_BUDGET_USD
  );
}

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function clampTokens(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LlmProxyTokenService {
  private readonly pricing: TierPricing;
  private readonly now: () => Date;
  private readonly config: ConfigReader;

  constructor(
    private readonly prisma: any,
    private readonly audit: AuditService,
    opts: LlmProxyTokenServiceOptions = {},
  ) {
    this.pricing = opts.pricing ?? new TierPricing();
    this.now = opts.now ?? (() => new Date());
    this.config = opts.config ?? getConfig;
  }

  /** The default monthly budget applied to grants and the backfill. */
  defaultBudgetUsd(): number {
    return defaultBudgetUsd(this.config);
  }

  // --------------------------------------------------------------------
  // Grant
  // --------------------------------------------------------------------

  async grant(
    userId: number,
    params: GrantParams,
    actorId: number | null,
    opts: GrantOptions = {},
    tx?: any,
  ): Promise<GrantResult> {
    const db = tx ?? this.prisma;
    const existing = await LlmProxyTokenRepository.findActiveForUser(
      db,
      userId,
    );
    if (existing) {
      throw new ConflictError(
        `User ${userId} already has an active LLM proxy token (id=${existing.id}).`,
      );
    }

    const tokenLimit = params.tokenLimit ?? LLM_PROXY_DEFAULT_TOKEN_LIMIT;
    const budgetUsd = params.budgetUsd ?? this.defaultBudgetUsd();
    const periodStart = utcMonthStart(this.now());

    const plaintext =
      TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = hashToken(plaintext);

    const execute = async (txClient: any) => {
      const created = await LlmProxyTokenRepository.create(txClient, {
        user_id: userId,
        token_hash: tokenHash,
        token_plaintext: plaintext,
        expires_at: params.expiresAt,
        token_limit: tokenLimit,
        budget_usd: budgetUsd,
        period_start: periodStart,
        granted_by: actorId,
      });
      // Single source of truth: the user's `allows_llm_proxy` flag is kept in
      // lockstep with token existence, in the same transaction as the token
      // write. This is what makes the admin group view (reads the flag) and
      // the per-user / users-page views (read token state) always agree.
      await txClient.user.update({
        where: { id: userId },
        data: { allows_llm_proxy: true },
      });
      await this.audit.record(txClient, {
        actor_user_id: actorId,
        action: 'grant_llm_proxy_token',
        target_user_id: userId,
        target_entity_type: 'LlmProxyToken',
        target_entity_id: String(created.id),
        details: {
          expiresAt: params.expiresAt.toISOString(),
          tokenLimit,
          budgetUsd,
          scope: opts.scope ?? 'single',
          scopeId: opts.scopeId ?? null,
        },
      });
      return created;
    };

    const row = tx ? await execute(tx) : await this.prisma.$transaction(execute);

    return { token: plaintext, row };
  }

  // --------------------------------------------------------------------
  // Revoke
  // --------------------------------------------------------------------

  async revoke(userId: number, actorId: number | null): Promise<void> {
    const active = await LlmProxyTokenRepository.findActiveForUser(
      this.prisma,
      userId,
    );
    if (!active) {
      throw new NotFoundError(
        `User ${userId} has no active LLM proxy token to revoke.`,
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx: any) => {
      await LlmProxyTokenRepository.setRevokedAt(tx, active.id, now);
      // Single source of truth: clear the permission flag in the same
      // transaction as the revoke, so no view can show the user as still
      // having LLM access after the token is gone.
      await tx.user.update({
        where: { id: userId },
        data: { allows_llm_proxy: false },
      });
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'revoke_llm_proxy_token',
        target_user_id: userId,
        target_entity_type: 'LlmProxyToken',
        target_entity_id: String(active.id),
        details: { revokedAt: now.toISOString() },
      });
    });
  }

  // --------------------------------------------------------------------
  // Reconcile (self-healing)
  // --------------------------------------------------------------------

  /**
   * Converge `allows_llm_proxy` with actual token state so the two can never
   * disagree. Invoked once at server startup (idempotent — already-consistent
   * users are untouched):
   *
   *   - flag `true` but no active token → grant a token (preserve access for
   *     students whose access was only ever recorded as the permission flag).
   *   - active token but flag `false`   → set the flag (so every view agrees).
   *
   * Never removes access. Tokens minted here get the default token limit and
   * the default monthly budget. Returns a summary for startup logging.
   */
  async reconcileAccessFlags(): Promise<{ tokensGranted: number; flagsSet: number }> {
    let tokensGranted = 0;
    let flagsSet = 0;

    // (1) Allowed but missing a live token → mint one so the credential exists.
    const allowed: Array<{ id: number }> = await this.prisma.user.findMany({
      where: { allows_llm_proxy: true },
      select: { id: true },
    });
    for (const u of allowed) {
      const active = await LlmProxyTokenRepository.findActiveForUser(this.prisma, u.id);
      if (!active) {
        await this.grant(
          u.id,
          {
            expiresAt: new Date(Date.now() + LLM_PROXY_AUTO_GRANT_TTL_MS),
            tokenLimit: LLM_PROXY_DEFAULT_TOKEN_LIMIT,
            budgetUsd: this.defaultBudgetUsd(),
          },
          null,
          { scope: 'reconcile' },
        );
        tokensGranted += 1;
      }
    }

    // (2) Has a live token but the flag is cleared → set it. updateMany with the
    // flag-false guard keeps this idempotent and returns 0 when already set.
    const now = new Date();
    const withTokens: Array<{ user_id: number }> = await this.prisma.llmProxyToken.findMany({
      where: { revoked_at: null, expires_at: { gt: now } },
      select: { user_id: true },
      distinct: ['user_id'],
    });
    for (const t of withTokens) {
      const updated = await this.prisma.user.updateMany({
        where: { id: t.user_id, allows_llm_proxy: false },
        data: { allows_llm_proxy: true },
      });
      flagsSet += updated.count;
    }

    if (tokensGranted > 0 || flagsSet > 0) {
      logger.info(
        { tokensGranted, flagsSet },
        '[llm-proxy reconcile] converged allows_llm_proxy with token state',
      );
    }
    return { tokensGranted, flagsSet };
  }

  // --------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------

  async getActiveForUser(userId: number): Promise<LlmProxyToken | null> {
    return LlmProxyTokenRepository.findActiveForUser(this.prisma, userId);
  }

  async getById(tokenId: number): Promise<LlmProxyToken | null> {
    return LlmProxyTokenRepository.findById(this.prisma, tokenId);
  }

  // --------------------------------------------------------------------
  // Ensure active (auto-grant)
  // --------------------------------------------------------------------

  /**
   * Return the user's active token with its plaintext, minting one when
   * there is none (first laptop login, or the previous token expired —
   * `findActiveForUser` already excludes expired rows, so an expired token
   * simply falls through to a fresh grant). A live row whose plaintext was
   * never stored (pre-plaintext-column rows) is unusable by a machine
   * client, so it is revoked and replaced the same way.
   *
   * Auto-grants use `LLM_PROXY_AUTO_GRANT_TTL_MS` (one year),
   * `LLM_PROXY_DEFAULT_TOKEN_LIMIT` and the default monthly budget.
   * `allows_llm_proxy` is set true in every path so the flag and token state
   * agree (the grant path does this inside its transaction; the found path
   * sets it idempotently).
   */
  async ensureActive(
    userId: number,
    actorId: number | null,
    scope: NonNullable<GrantOptions['scope']>,
  ): Promise<EnsureActiveResult> {
    const existing = await LlmProxyTokenRepository.findActiveForUser(this.prisma, userId);
    if (existing && existing.token_plaintext != null) {
      await this.prisma.user.updateMany({
        where: { id: userId, allows_llm_proxy: false },
        data: { allows_llm_proxy: true },
      });
      return { token: existing.token_plaintext, row: existing, granted: false };
    }
    if (existing) {
      logger.warn(
        { userId, tokenId: existing.id },
        '[llm-proxy-token-service] active token has no stored plaintext; replacing it',
      );
      await this.revoke(userId, actorId);
    }
    const { token, row } = await this.grant(
      userId,
      {
        expiresAt: new Date(Date.now() + LLM_PROXY_AUTO_GRANT_TTL_MS),
        tokenLimit: LLM_PROXY_DEFAULT_TOKEN_LIMIT,
        budgetUsd: this.defaultBudgetUsd(),
      },
      actorId,
      { scope },
    );
    return { token, row, granted: true };
  }

  // --------------------------------------------------------------------
  // Validate (hot path)
  // --------------------------------------------------------------------

  /**
   * Validate a raw bearer token. Throws typed errors that the bearer-auth
   * middleware translates into HTTP 401 / 429. Returns the row as it stands
   * after any monthly period roll. `now` defaults to the service clock.
   */
  async validate(plaintext: string, now?: Date): Promise<LlmProxyToken> {
    if (!plaintext) {
      throw new LlmProxyTokenUnauthorizedError('Missing bearer token');
    }

    const hash = hashToken(plaintext);
    const row = await LlmProxyTokenRepository.findByHash(this.prisma, hash);

    if (!row) {
      throw new LlmProxyTokenUnauthorizedError(
        'Invalid or revoked LLM proxy token',
      );
    }
    return this.assertUsable(row, now);
  }

  /**
   * The pre-request check: revoked or expired → 401; then roll the monthly
   * period if a new UTC month has started; then enforce the budget —
   * `spent_usd >= budget_usd` → 429, or the legacy `tokens_used >=
   * token_limit` check while `budget_usd` is null. Returns the row after the
   * roll so callers see the current period.
   */
  async assertUsable(token: LlmProxyToken, now: Date = this.now()): Promise<LlmProxyToken> {
    if (token.revoked_at !== null) {
      throw new LlmProxyTokenUnauthorizedError(
        'Invalid or revoked LLM proxy token',
      );
    }
    if (token.expires_at.getTime() < now.getTime()) {
      throw new LlmProxyTokenUnauthorizedError(
        'LLM proxy token has expired',
      );
    }

    const current = await this.rollPeriodIfNeeded(token, now);

    if (current.budget_usd != null) {
      if (current.spent_usd >= current.budget_usd) {
        const resets = this.periodResetsAt(current, now).slice(0, 10);
        throw new LlmProxyTokenQuotaExceededError(
          `monthly budget of ${formatUsd(current.budget_usd)} reached; resets ${resets}`,
        );
      }
    } else if (current.tokens_used >= current.token_limit) {
      throw new LlmProxyTokenQuotaExceededError(
        'LLM proxy token quota exhausted',
      );
    }

    return current;
  }

  /**
   * Start a new monthly period when `period_start` is null or before the
   * first instant of the UTC month containing `now`: `spent_usd` becomes 0
   * and `period_start` the month start (persisted). Otherwise the token is
   * returned unchanged.
   */
  async rollPeriodIfNeeded(token: LlmProxyToken, now: Date = this.now()): Promise<LlmProxyToken> {
    const start = utcMonthStart(now);
    if (token.period_start != null && token.period_start.getTime() >= start.getTime()) {
      return token;
    }
    const rolled = await LlmProxyTokenRepository.rollPeriod(this.prisma, token.id, start);
    return rolled ?? token;
  }

  /**
   * ISO timestamp of the first instant of the next UTC month — when the
   * period in effect at `now` ends and `spent_usd` resets.
   */
  periodResetsAt(token: LlmProxyToken, now: Date = this.now()): string {
    const current = utcMonthStart(now);
    const base =
      token.period_start != null && token.period_start.getTime() > current.getTime()
        ? token.period_start
        : current;
    return utcNextMonthStart(base).toISOString();
  }

  /**
   * Dollar fields for a token payload. Read-only: a stale period (last
   * month's `period_start`) is reported as $0 spent without persisting the
   * roll, which `assertUsable` does on the next request.
   */
  budgetSummary(token: LlmProxyToken, now: Date = this.now()): BudgetSummary {
    const current = utcMonthStart(now);
    const stale =
      token.period_start == null || token.period_start.getTime() < current.getTime();
    return {
      budgetUsd: token.budget_usd ?? null,
      spentUsd: stale ? 0 : token.spent_usd,
      spentUsdTotal: token.spent_usd_total,
      periodResetsAt: this.periodResetsAt(token, now),
    };
  }

  // --------------------------------------------------------------------
  // Budget administration
  // --------------------------------------------------------------------

  /**
   * Change one token's monthly budget. Audited as
   * `llm_proxy_budget_changed { from, to }` in the same transaction.
   */
  async setBudget(tokenId: number, budgetUsd: number, actorId: number | null): Promise<LlmProxyToken> {
    if (!isValidBudgetUsd(budgetUsd)) {
      throw new ValidationError(
        `budgetUsd must be a positive number no greater than ${LLM_PROXY_MAX_BUDGET_USD}.`,
      );
    }
    const row = await LlmProxyTokenRepository.findById(this.prisma, tokenId);
    if (!row) {
      throw new NotFoundError(`LLM proxy token ${tokenId} not found.`);
    }
    return this.prisma.$transaction(async (tx: any) => {
      const updated = await LlmProxyTokenRepository.setBudget(tx, tokenId, budgetUsd);
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'llm_proxy_budget_changed',
        target_user_id: row.user_id,
        target_entity_type: 'LlmProxyToken',
        target_entity_id: String(tokenId),
        details: { from: row.budget_usd ?? null, to: budgetUsd },
      });
      return updated;
    });
  }

  /**
   * Give every token without a budget the configured default (the
   * post-migration "Set default budget on all tokens" action). Returns the
   * number of rows changed; audited once as `llm_proxy_budget_backfilled`
   * when anything changed.
   */
  async backfillDefaultBudget(actorId: number | null): Promise<number> {
    const budgetUsd = this.defaultBudgetUsd();
    return this.prisma.$transaction(async (tx: any) => {
      const count = await LlmProxyTokenRepository.backfillBudget(tx, budgetUsd);
      if (count > 0) {
        await this.audit.record(tx, {
          actor_user_id: actorId,
          action: 'llm_proxy_budget_backfilled',
          target_entity_type: 'LlmProxyToken',
          details: { budgetUsd, count },
        });
      }
      return count;
    });
  }

  // --------------------------------------------------------------------
  // Record usage — best-effort accounting
  // --------------------------------------------------------------------

  /**
   * Record usage for a proxied call: bump the token's counters and dollar
   * totals and insert one LlmProxyRequest row, in one transaction. Cost is
   * `usage.costUsd` when the forwarder supplied one, else the TierPricing
   * estimate for the tier of `usage.modelSent`.
   *
   * Swallows and logs errors so a transient DB hiccup does not surface to
   * the student (their upstream call already succeeded by the time we get
   * here). Callers fire-and-forget.
   */
  async recordUsage(tokenId: number, usage: UsageReport): Promise<void> {
    const inputTokens = clampTokens(usage.inputTokens);
    const outputCount = clampTokens(usage.outputTokens);
    const modelSent = usage.modelSent ?? null;
    const reported = usage.costUsd;
    const costUsd =
      typeof reported === 'number' && Number.isFinite(reported) && reported >= 0
        ? reported
        : this.pricing.costUsd(this.pricing.tierFor(modelSent), inputTokens, outputCount);

    try {
      await this.prisma.$transaction(async (tx: any) => {
        const row = await LlmProxyTokenRepository.recordUsage(tx, tokenId, {
          inputTokens,
          outputTokens: outputCount,
          costUsd,
        });
        await LlmProxyTokenRepository.createRequest(tx, {
          token_id: tokenId,
          user_id: row.user_id,
          protocol: usage.protocol ?? 'openai',
          model_requested: usage.modelRequested ?? null,
          model_sent: modelSent,
          input_tokens: inputTokens,
          output_tokens: outputCount,
          cost_usd: costUsd,
          status: usage.status ?? 200,
        });
      });
    } catch (err) {
      logger.warn(
        { err, tokenId, inputTokens, outputTokens: outputCount, costUsd },
        '[llm-proxy-token-service] recordUsage failed; counters may drift',
      );
    }
  }
}
