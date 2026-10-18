/**
 * LlmProxyTokenRepository — typed CRUD for the LlmProxyToken model (Sprint 013)
 * and its per-request log, LlmProxyRequest (sprint 003).
 *
 * All methods accept a DbClient as their first argument so they can be
 * composed inside a service-owned transaction without holding state.
 *
 * Responsibilities:
 *  - CRUD on LlmProxyToken rows.
 *  - Active-token lookup for a given user (non-revoked, non-expired).
 *  - Lookup by token_hash for the proxy hot path.
 *  - Atomic usage accounting: token counters plus the dollar columns.
 *  - Monthly period roll, budget updates and the admin backfill.
 *  - LlmProxyRequest inserts and retention pruning.
 */
import type { LlmProxyRequest, LlmProxyToken } from '../../generated/prisma/client.js';
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
  /** Monthly dollar cap; null keeps the legacy token-count quota. */
  budget_usd?: number | null;
  /** First instant of the current UTC month at grant time. */
  period_start?: Date | null;
  granted_by: number | null;
};

export type UsageIncrement = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type CreateLlmProxyRequestInput = {
  token_id: number;
  user_id: number;
  protocol: 'openai' | 'anthropic';
  model_requested: string | null;
  model_sent: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  status: number;
  /** Defaults to now(); tests seed old rows for the prune job. */
  ts?: Date;
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
   * Atomically add one request's usage to the token: tokens_used and
   * request_count (legacy counters) plus spent_usd (this period) and
   * spent_usd_total (lifetime). Returns the updated row.
   */
  async recordUsage(
    db: DbClient,
    id: number,
    usage: UsageIncrement,
  ): Promise<LlmProxyToken> {
    return (db as any).llmProxyToken.update({
      where: { id },
      data: {
        tokens_used: { increment: usage.inputTokens + usage.outputTokens },
        request_count: { increment: 1 },
        spent_usd: { increment: usage.costUsd },
        spent_usd_total: { increment: usage.costUsd },
      },
    });
  },

  /**
   * Start a new monthly period: zero this period's spend and stamp its
   * start. Guarded so two concurrent first-of-the-month requests roll once
   * (the second finds period_start already at `periodStart`). Returns the
   * row as it is after the call either way.
   */
  async rollPeriod(
    db: DbClient,
    id: number,
    periodStart: Date,
  ): Promise<LlmProxyToken | null> {
    await (db as any).llmProxyToken.updateMany({
      where: {
        id,
        OR: [{ period_start: null }, { period_start: { lt: periodStart } }],
      },
      data: { spent_usd: 0, period_start: periodStart },
    });
    return (db as any).llmProxyToken.findUnique({ where: { id } });
  },

  async setBudget(
    db: DbClient,
    id: number,
    budgetUsd: number,
  ): Promise<LlmProxyToken> {
    return (db as any).llmProxyToken.update({
      where: { id },
      data: { budget_usd: budgetUsd },
    });
  },

  /** Set `budget_usd` on every row that has none. Returns the row count. */
  async backfillBudget(db: DbClient, budgetUsd: number): Promise<number> {
    const result = await (db as any).llmProxyToken.updateMany({
      where: { budget_usd: null },
      data: { budget_usd: budgetUsd },
    });
    return result.count as number;
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

  // -------------------------------------------------------------------------
  // LlmProxyRequest
  // -------------------------------------------------------------------------

  async createRequest(
    db: DbClient,
    data: CreateLlmProxyRequestInput,
  ): Promise<LlmProxyRequest> {
    return (db as any).llmProxyRequest.create({ data });
  },

  /** Delete request rows with `ts` strictly before `cutoff`. Returns the count. */
  async deleteRequestsBefore(db: DbClient, cutoff: Date): Promise<number> {
    const result = await (db as any).llmProxyRequest.deleteMany({
      where: { ts: { lt: cutoff } },
    });
    return result.count as number;
  },
};
