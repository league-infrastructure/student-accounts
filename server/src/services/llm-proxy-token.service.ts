/**
 * LlmProxyTokenService — domain logic for the LlmProxyToken entity (Sprint 013).
 *
 * Responsibilities:
 *  - Grant a new token: generate an opaque random string, hash it (SHA-256),
 *    persist the hash + metadata, return the plaintext exactly once.
 *  - Revoke the active token for a user.
 *  - Validate a bearer token on the proxy hot path: hash lookup, revocation
 *    check, expiration check, hard quota cut-off.
 *  - Record usage (tokens_used + request_count) after a forwarded call.
 *  - Audit-event recording in the same transaction as the mutation
 *    (AuditService invariant).
 *
 * Errors thrown:
 *  - ConflictError (409) — a user already has an active token at grant time.
 *  - NotFoundError (404) — user has no active token to revoke.
 *  - LlmProxyTokenUnauthorizedError (401) — bearer is missing, unknown,
 *    revoked, or expired.
 *  - LlmProxyTokenQuotaExceededError (429) — token's quota is exhausted.
 *
 * Security invariants:
 *  - The plaintext token is never persisted. It is generated in memory,
 *    returned to the caller of `grant()` exactly once, and discarded.
 *  - The token format is `llmp_<base64url(randomBytes(32))>`. The prefix
 *    aids identification in logs/pastes and does not affect validation.
 */

import { randomBytes, createHash } from 'node:crypto';

import { AppError, ConflictError, NotFoundError } from '../errors.js';
import { createLogger } from './logger.js';
import type { AuditService } from './audit.service.js';
import { LlmProxyTokenRepository } from './repositories/llm-proxy-token.repository.js';
import type { LlmProxyToken } from '../generated/prisma/client.js';

const logger = createLogger('llm-proxy-token-service');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Random bytes that seed the opaque part of the token. */
export const TOKEN_BYTES = 32;

/** Prefix stamped on every plaintext token — helps pattern-match in logs. */
export const TOKEN_PREFIX = 'llmp_';

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
 * Thrown when a token's quota is exhausted (`tokens_used >= token_limit`).
 * The route layer translates this to HTTP 429.
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
  tokenLimit: number;
};

export type GrantOptions = {
  /** Origin of the grant — feeds the audit event `details` blob. */
  scope?: 'single' | 'cohort' | 'group' | 'reconcile';
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
  /** Persisted row (without plaintext, which is not stored). */
  row: LlmProxyToken;
};

// ---------------------------------------------------------------------------
// Hash helper
// ---------------------------------------------------------------------------

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LlmProxyTokenService {
  constructor(
    private readonly prisma: any,
    private readonly audit: AuditService,
  ) {}

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

    const plaintext =
      TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = hashToken(plaintext);

    const execute = async (txClient: any) => {
      const created = await LlmProxyTokenRepository.create(txClient, {
        user_id: userId,
        token_hash: tokenHash,
        token_plaintext: plaintext,
        expires_at: params.expiresAt,
        token_limit: params.tokenLimit,
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
          tokenLimit: params.tokenLimit,
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
   * Never removes access. Returns a summary for startup logging.
   */
  async reconcileAccessFlags(): Promise<{ tokensGranted: number; flagsSet: number }> {
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const DEFAULT_TOKEN_LIMIT = 1_000_000;
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
          { expiresAt: new Date(Date.now() + ONE_YEAR_MS), tokenLimit: DEFAULT_TOKEN_LIMIT },
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

  // --------------------------------------------------------------------
  // Validate (hot path)
  // --------------------------------------------------------------------

  /**
   * Validate a raw bearer token. Throws typed errors that the bearer-auth
   * middleware translates into HTTP 401 / 429.
   */
  async validate(plaintext: string): Promise<LlmProxyToken> {
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
    if (row.revoked_at !== null) {
      throw new LlmProxyTokenUnauthorizedError(
        'Invalid or revoked LLM proxy token',
      );
    }
    if (row.expires_at.getTime() < Date.now()) {
      throw new LlmProxyTokenUnauthorizedError(
        'LLM proxy token has expired',
      );
    }
    if (row.tokens_used >= row.token_limit) {
      throw new LlmProxyTokenQuotaExceededError(
        'LLM proxy token quota exhausted',
      );
    }

    return row;
  }

  // --------------------------------------------------------------------
  // Record usage — best-effort accounting, runs outside a transaction
  // --------------------------------------------------------------------

  /**
   * Record usage for a proxied call. Swallows and logs errors so a
   * transient DB hiccup does not surface to the student (their call to
   * Anthropic already succeeded by the time we get here).
   */
  async recordUsage(
    tokenId: number,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    try {
      await LlmProxyTokenRepository.incrementUsage(
        this.prisma,
        tokenId,
        Math.max(0, inputTokens),
        Math.max(0, outputTokens),
      );
    } catch (err) {
      logger.warn(
        { err, tokenId, inputTokens, outputTokens },
        '[llm-proxy-token-service] recordUsage failed; counters may drift',
      );
    }
  }
}
