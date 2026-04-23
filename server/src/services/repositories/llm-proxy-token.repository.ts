/**
 * LlmProxyTokenRepository — typed CRUD for the LlmProxyToken model (Sprint 013).
 *
 * All methods accept a DbClient as their first argument so they can be
 * composed inside a service-owned transaction without holding state.
 *
 * Responsibilities:
 *  - CRUD on LlmProxyToken rows.
 *  - Active-token lookup for a given user (non-revoked, non-expired).
 *  - Lookup by token_hash for the proxy hot path.
 *  - Atomic `increment` for usage counters (tokens_used, request_count).
 */
import type { LlmProxyToken } from '../../generated/prisma/client.js';
import type { DbClient } from './types.js';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type CreateLlmProxyTokenInput = {
  user_id: number;
  token_hash: string;
  /** Shown to the student on their Account page. Optional for callers
   *  that don't want to surface the value (none currently). */
  token_plaintext?: string | null;
  expires_at: Date;
  token_limit: number;
  granted_by: number | null;
};

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export const LlmProxyTokenRepository = {
  async create(
    db: DbClient,
    data: CreateLlmProxyTokenInput,
  ): Promise<LlmProxyToken> {
    return (db as any).llmProxyToken.create({ data });
  },

  async findById(db: DbClient, id: number): Promise<LlmProxyToken | null> {
    return (db as any).llmProxyToken.findUnique({ where: { id } });
  },

  async findByHash(
    db: DbClient,
    token_hash: string,
  ): Promise<LlmProxyToken | null> {
    return (db as any).llmProxyToken.findUnique({ where: { token_hash } });
  },

  /**
   * Returns the single active (non-revoked, non-expired) token for a user,
   * or null when none exists. By construction there is at most one active
   * token per user because grant() enforces that invariant at the service
   * layer — no DB-level unique partial index is applied because SQLite +
   * Prisma does not support them cleanly, and the service transaction is
   * authoritative.
   */
  async findActiveForUser(
    db: DbClient,
    userId: number,
    now: Date = new Date(),
  ): Promise<LlmProxyToken | null> {
    return (db as any).llmProxyToken.findFirst({
      where: {
        user_id: userId,
        revoked_at: null,
        expires_at: { gt: now },
      },
      orderBy: { granted_at: 'desc' },
    });
  },

  async listForUser(db: DbClient, userId: number): Promise<LlmProxyToken[]> {
    return (db as any).llmProxyToken.findMany({
      where: { user_id: userId },
      orderBy: { granted_at: 'desc' },
    });
  },

  /**
   * Atomically increment tokens_used and request_count. Returns the updated
   * row.
   */
  async incrementUsage(
    db: DbClient,
    id: number,
    inputTokens: number,
    outputTokens: number,
  ): Promise<LlmProxyToken> {
    return (db as any).llmProxyToken.update({
      where: { id },
      data: {
        tokens_used: { increment: inputTokens + outputTokens },
        request_count: { increment: 1 },
      },
    });
  },

  async setRevokedAt(
    db: DbClient,
    id: number,
    revokedAt: Date,
  ): Promise<LlmProxyToken> {
    return (db as any).llmProxyToken.update({
      where: { id },
      data: { revoked_at: revokedAt },
    });
  },
};
