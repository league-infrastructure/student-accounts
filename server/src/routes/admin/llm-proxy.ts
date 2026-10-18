/**
 * Admin LLM-proxy routes (Sprint 013 T005).
 *
 * Mounted under /admin by adminRouter. All routes inherit requireAuth +
 * requireRole('admin') from the parent.
 *
 * Endpoints in this module:
 *   POST   /admin/users/:id/llm-proxy-token      — grant; returns plaintext once.
 *   DELETE /admin/users/:id/llm-proxy-token      — revoke; 204.
 *   GET    /admin/users/:id/llm-proxy-token      — status (plaintext for admins, no hash).
 *   PATCH  /admin/llm-proxy/tokens/:id           — { budgetUsd }: change a token's
 *                                                  monthly budget (sprint 003).
 *   POST   /admin/llm-proxy/backfill-budgets     — set the default budget on every
 *                                                  token that has none (sprint 003).
 *   POST   /admin/groups/:id/llm-proxy/bulk-grant / bulk-revoke — bulk by group.
 *
 * Grant bodies take `expiresAt` (required), `budgetUsd` (optional, default
 * LLM_PROXY_DEFAULT_BUDGET_USD) and `tokenLimit` (optional legacy quota,
 * default LLM_PROXY_DEFAULT_TOKEN_LIMIT).
 *
 * Error mapping:
 *   AppError subclasses (ConflictError, NotFoundError, ValidationError,
 *   LlmProxyTokenUnauthorizedError, LlmProxyTokenQuotaExceededError,
 *   LlmProxyNotConfiguredError) — use their own statusCode.
 *   Unknown errors — fall through to the global errorHandler (500).
 */

import { Router } from 'express';
import { AppError, NotFoundError } from '../../errors.js';
import { UserRepository } from '../../services/repositories/user.repository.js';
import { prisma } from '../../services/prisma.js';
import { adminBus, userBus } from '../../services/change-bus.js';
import {
  isValidBudgetUsd,
  LLM_PROXY_DEFAULT_TOKEN_LIMIT,
  LLM_PROXY_MAX_BUDGET_USD,
  type BudgetSummary,
} from '../../services/llm-proxy-token.service.js';
import type { LlmProxyToken } from '../../generated/prisma/client.js';

export const adminLlmProxyRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseIntParam(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

function handleError(err: unknown, res: any, next: any) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  return next(err);
}

function parseFutureDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= Date.now()) return null;
  return d;
}

function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (!Number.isInteger(raw)) return null;
  if (raw <= 0) return null;
  return raw;
}

const BUDGET_ERROR = `budgetUsd must be a positive number no greater than ${LLM_PROXY_MAX_BUDGET_USD}.`;
const TOKEN_LIMIT_ERROR = 'tokenLimit must be a positive integer.';

type GrantBody = { expiresAt?: unknown; tokenLimit?: unknown; budgetUsd?: unknown };

/**
 * Validate the shared grant fields. Returns the parsed params, or an error
 * message for a 400. `tokenLimit` and `budgetUsd` are optional; when absent
 * the service applies its defaults.
 */
function parseGrantBody(
  body: GrantBody,
): { ok: true; expiresAt: Date; tokenLimit: number; budgetUsd?: number } | { ok: false; error: string } {
  const expiresAt = parseFutureDate(body.expiresAt);
  if (!expiresAt) {
    return { ok: false, error: 'expiresAt must be an ISO 8601 date/time in the future.' };
  }
  const tokenLimit =
    body.tokenLimit === undefined ? LLM_PROXY_DEFAULT_TOKEN_LIMIT : parsePositiveInt(body.tokenLimit);
  if (!tokenLimit) return { ok: false, error: TOKEN_LIMIT_ERROR };
  if (body.budgetUsd !== undefined && !isValidBudgetUsd(body.budgetUsd)) {
    return { ok: false, error: BUDGET_ERROR };
  }
  return {
    ok: true,
    expiresAt,
    tokenLimit,
    ...(body.budgetUsd !== undefined ? { budgetUsd: body.budgetUsd as number } : {}),
  };
}

// Render the client-facing shape for an enabled token (no plaintext, no hash).
function renderActive(row: LlmProxyToken, budget: BudgetSummary) {
  return {
    enabled: true,
    tokenId: row.id,
    tokensUsed: row.tokens_used,
    tokenLimit: row.token_limit,
    requestCount: row.request_count,
    budgetUsd: budget.budgetUsd,
    spentUsd: budget.spentUsd,
    spentUsdTotal: budget.spentUsdTotal,
    periodResetsAt: budget.periodResetsAt,
    expiresAt: row.expires_at,
    grantedAt: row.granted_at,
    grantedBy: row.granted_by,
    revokedAt: row.revoked_at,
  };
}

// ---------------------------------------------------------------------------
// GET /admin/users/:id/llm-proxy-token
// ---------------------------------------------------------------------------

adminLlmProxyRouter.get(
  '/users/:id/llm-proxy-token',
  async (req, res, next) => {
    try {
      const userId = parseIntParam(req.params.id);
      if (userId === null)
        return res.status(400).json({ error: 'Invalid user id' });

      const user = await UserRepository.findByIdIncludingInactive(prisma, userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Derive the proxy endpoint from the request origin, mirroring the
      // student-facing /account/llm-proxy route so the admin sees the exact
      // ANTHROPIC_BASE_URL the student would use. Base is returned without
      // /v1 because the Anthropic SDK appends /v1/messages itself.
      const forwardedProto = req.header('x-forwarded-proto');
      const scheme = forwardedProto
        ? forwardedProto.split(',')[0].trim()
        : (req as any).secure
          ? 'https'
          : 'http';
      const host = req.header('x-forwarded-host') ?? req.get('host') ?? 'localhost';
      const endpoint = `${scheme}://${host}/proxy`;

      const tokens = req.services.llmProxyTokens;
      const active = await tokens.getActiveForUser(userId);
      if (!active) {
        return res.json({ enabled: false, endpoint });
      }
      // Admins intentionally see the full plaintext key here so they can read
      // setup instructions and the working token back to a student.
      return res.json({
        ...renderActive(active, tokens.budgetSummary(active)),
        endpoint,
        token: active.token_plaintext ?? null,
      });
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/users/:id/llm-proxy-token
// ---------------------------------------------------------------------------

adminLlmProxyRouter.post(
  '/users/:id/llm-proxy-token',
  async (req, res, next) => {
    try {
      const userId = parseIntParam(req.params.id);
      if (userId === null)
        return res.status(400).json({ error: 'Invalid user id' });

      const parsed = parseGrantBody((req.body ?? {}) as GrantBody);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const { expiresAt, tokenLimit, budgetUsd } = parsed;

      const user = await UserRepository.findByIdIncludingInactive(prisma, userId);
      if (!user) throw new NotFoundError('User not found');

      const actorId = (req.session as any).userId as number;
      const result = await req.services.llmProxyTokens.grant(
        userId,
        { expiresAt, tokenLimit, budgetUsd },
        actorId,
        { scope: 'single', llmProxyAllowed: true },
      );

      userBus.notifyUser(userId);
      adminBus.notify('users');

      return res.status(201).json({
        token: result.token,
        tokenId: result.row.id,
        tokenLimit: result.row.token_limit,
        budgetUsd: result.row.budget_usd,
        expiresAt: result.row.expires_at,
        grantedAt: result.row.granted_at,
      });
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id/llm-proxy-token
// ---------------------------------------------------------------------------

adminLlmProxyRouter.delete(
  '/users/:id/llm-proxy-token',
  async (req, res, next) => {
    try {
      const userId = parseIntParam(req.params.id);
      if (userId === null)
        return res.status(400).json({ error: 'Invalid user id' });

      const user = await UserRepository.findByIdIncludingInactive(prisma, userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const actorId = (req.session as any).userId as number;
      await req.services.llmProxyTokens.revoke(userId, actorId);

      userBus.notifyUser(userId);
      adminBus.notify('users');

      return res.status(204).send();
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /admin/llm-proxy/tokens/:id — { budgetUsd } (sprint 003)
// ---------------------------------------------------------------------------
//
// Changes one token's monthly dollar budget without re-granting. 400 unless
// budgetUsd is a positive number no greater than LLM_PROXY_MAX_BUDGET_USD;
// 404 for an unknown token id. Audited by the service as
// llm_proxy_budget_changed { from, to }. Returns the admin status shape.

adminLlmProxyRouter.patch(
  '/llm-proxy/tokens/:id',
  async (req, res, next) => {
    try {
      const tokenId = parseIntParam(req.params.id);
      if (tokenId === null) return res.status(400).json({ error: 'Invalid token id' });

      const body = (req.body ?? {}) as { budgetUsd?: unknown };
      if (!isValidBudgetUsd(body.budgetUsd)) {
        return res.status(400).json({ error: BUDGET_ERROR });
      }

      const actorId = (req.session as any).userId as number;
      const tokens = req.services.llmProxyTokens;
      const updated = await tokens.setBudget(tokenId, body.budgetUsd, actorId);

      userBus.notifyUser(updated.user_id);
      adminBus.notify('users');

      return res.json({
        ...renderActive(updated, tokens.budgetSummary(updated)),
        userId: updated.user_id,
      });
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/llm-proxy/backfill-budgets (sprint 003)
// ---------------------------------------------------------------------------
//
// The post-migration "Set default budget on all tokens" action: every token
// with budget_usd NULL gets LLM_PROXY_DEFAULT_BUDGET_USD. Idempotent.
// Returns { updated, budgetUsd }.

adminLlmProxyRouter.post(
  '/llm-proxy/backfill-budgets',
  async (req, res, next) => {
    try {
      const actorId = (req.session as any).userId as number;
      const tokens = req.services.llmProxyTokens;
      const updated = await tokens.backfillDefaultBudget(actorId);
      if (updated > 0) adminBus.notify('users');
      return res.json({ updated, budgetUsd: tokens.defaultBudgetUsd() });
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// Bulk endpoints — group-scoped only. Cohort-scoped bulk operations were
// removed when cohorts became a Google-OU-only view; admins sync a cohort
// into a group and run bulk ops there.
// ---------------------------------------------------------------------------

function bulkResultStatus(result: { succeeded: number[]; failed: { userId: number }[] }) {
  if (result.failed.length > 0) return 207;
  return 200;
}

// POST /admin/groups/:id/llm-proxy/bulk-grant
adminLlmProxyRouter.post(
  '/groups/:id/llm-proxy/bulk-grant',
  async (req, res, next) => {
    try {
      const id = parseIntParam(req.params.id);
      if (id === null) return res.status(400).json({ error: 'Invalid group id' });

      const body = (req.body ?? {}) as GrantBody & { userIds?: unknown };
      const parsed = parseGrantBody(body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const { expiresAt, tokenLimit, budgetUsd } = parsed;

      const parsedUserIds =
        Array.isArray(body.userIds) &&
        body.userIds.every((uid) => typeof uid === 'number')
          ? (body.userIds as number[])
          : undefined;

      const actorId = (req.session as any).userId as number;
      const result = await req.services.bulkLlmProxy.bulkGrant(
        { kind: 'group', id },
        { expiresAt, tokenLimit, budgetUsd },
        actorId,
        parsedUserIds,
      );

      for (const userId of result.succeeded) {
        userBus.notifyUser(userId);
      }
      adminBus.notify('users');
      adminBus.notify('groups');

      return res.status(bulkResultStatus(result)).json(result);
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

// POST /admin/groups/:id/llm-proxy/bulk-revoke
adminLlmProxyRouter.post(
  '/groups/:id/llm-proxy/bulk-revoke',
  async (req, res, next) => {
    try {
      const id = parseIntParam(req.params.id);
      if (id === null) return res.status(400).json({ error: 'Invalid group id' });

      const body = (req.body ?? {}) as { userIds?: unknown };

      const parsedUserIds =
        Array.isArray(body.userIds) &&
        body.userIds.every((uid) => typeof uid === 'number')
          ? (body.userIds as number[])
          : undefined;

      const actorId = (req.session as any).userId as number;
      const result = await req.services.bulkLlmProxy.bulkRevoke(
        { kind: 'group', id },
        actorId,
        parsedUserIds,
      );

      for (const userId of result.succeeded) {
        userBus.notifyUser(userId);
      }
      adminBus.notify('users');
      adminBus.notify('groups');

      return res.status(bulkResultStatus(result)).json(result);
    } catch (err) {
      handleError(err, res, next);
    }
  },
);
