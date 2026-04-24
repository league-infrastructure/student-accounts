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
  scope?: 'single' | 'cohort' | 'group';
  scopeId?: number | null;
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
    actorId: number,
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

  async revoke(userId: number, actorId: number): Promise<void> {
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
