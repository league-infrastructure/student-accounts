/**
 * Admin LLM-proxy routes (Sprint 013 T005).
 *
 * Mounted under /admin by adminRouter. All routes inherit requireAuth +
 * requireRole('admin') from the parent.
 *
 * Endpoints in this module:
 *   POST   /admin/users/:id/llm-proxy-token  — grant; returns plaintext once.
 *   DELETE /admin/users/:id/llm-proxy-token  — revoke; 204.
 *   GET    /admin/users/:id/llm-proxy-token  — status (no plaintext, no hash).
 *
 * Bulk cohort / group routes are added in T007.
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

// Render the client-facing shape for an enabled token (no plaintext, no hash).
function renderActive(row: {
  id: number;
  tokens_used: number;
  token_limit: number;
  request_count: number;
  expires_at: Date;
  granted_at: Date;
  granted_by: number | null;
  revoked_at: Date | null;
}) {
  return {
    enabled: true,
    tokenId: row.id,
    tokensUsed: row.tokens_used,
    tokenLimit: row.token_limit,
    requestCount: row.request_count,
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

      const active = await req.services.llmProxyTokens.getActiveForUser(userId);
      if (!active) {
        return res.json({ enabled: false });
      }
      return res.json(renderActive(active as any));
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

      const body = (req.body ?? {}) as { expiresAt?: unknown; tokenLimit?: unknown };
      const expiresAt = parseFutureDate(body.expiresAt);
      if (!expiresAt) {
        return res.status(400).json({
          error: 'expiresAt must be an ISO 8601 date/time in the future.',
        });
      }
      const tokenLimit = parsePositiveInt(body.tokenLimit);
      if (!tokenLimit) {
        return res.status(400).json({
          error: 'tokenLimit must be a positive integer.',
        });
      }

      const user = await UserRepository.findByIdIncludingInactive(prisma, userId);
      if (!user) throw new NotFoundError('User not found');

      const actorId = (req.session as any).userId as number;
      const result = await req.services.llmProxyTokens.grant(
        userId,
        { expiresAt, tokenLimit },
        actorId,
        { scope: 'single' },
      );

      return res.status(201).json({
        token: result.token,
        tokenId: result.row.id,
        tokenLimit: result.row.token_limit,
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
      return res.status(204).send();
    } catch (err) {
      handleError(err, res, next);
    }
  },
);
