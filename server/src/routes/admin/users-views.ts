/**
 * Admin "users views" — two saved views that show subsets of users and
 * expose the same bulk-action shape as a group detail panel:
 *
 *   1. Student accounts — every active user whose primary email matches
 *      the student domain. Bulk action: suspend all active workspace +
 *      claude ExternalAccounts for the selected users.
 *
 *   2. LLM proxy users — every active user who currently holds an active
 *      LLM proxy token. Bulk action: revoke the token.
 *
 * Endpoints registered here:
 *   GET  /admin/users/with-llm-proxy
 *   POST /admin/users/bulk-suspend-accounts     body: { userIds: number[] }
 *   POST /admin/users/bulk-revoke-llm-proxy     body: { userIds: number[] }
 *
 * These routes must be mounted BEFORE adminUsersRouter in admin/index.ts
 * so the literal segments (`/users/with-llm-proxy`, `/users/bulk-*`) win
 * against the `/users/:id` pattern defined there.
 *
 * Auth: inherits requireAuth + requireRole('admin') from adminRouter.
 */

import { Router } from 'express';
import { prisma } from '../../services/prisma.js';
import { AppError } from '../../errors.js';
import { adminBus, userBus } from '../../services/change-bus.js';

export const adminUsersViewsRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseUserIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) return null;
    out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// GET /admin/users/with-llm-proxy
// Returns every active user with a currently-active LLM proxy token,
// plus token usage / expiry fields the UI needs to render.
// ---------------------------------------------------------------------------

adminUsersViewsRouter.get('/users/with-llm-proxy', async (_req, res, next) => {
  try {
    const now = new Date();
    const tokens = await (prisma as any).llmProxyToken.findMany({
      where: {
        revoked_at: null,
        expires_at: { gt: now },
        user: { is_active: true },
      },
      include: {
        user: {
          select: {
            id: true,
            display_name: true,
            primary_email: true,
            role: true,
            cohort: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ user: { display_name: 'asc' } }],
    });

    res.json(
      tokens.map((t: any) => ({
        userId: t.user.id,
        displayName: t.user.display_name,
        email: t.user.primary_email,
        role: t.user.role,
        cohort: t.user.cohort ? { id: t.user.cohort.id, name: t.user.cohort.name } : null,
        tokenId: t.id,
        tokensUsed: t.tokens_used,
        tokenLimit: t.token_limit,
        requestCount: t.request_count,
        expiresAt: t.expires_at,
        grantedAt: t.granted_at,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/users/bulk-suspend-accounts
// Suspends every active workspace + claude ExternalAccount for the users
// listed in the request body. Fail-soft per account — the batch is not
// aborted by a single failure.
// ---------------------------------------------------------------------------

adminUsersViewsRouter.post(
  '/users/bulk-suspend-accounts',
  async (req, res, next) => {
    try {
      const { userIds } = (req.body ?? {}) as { userIds?: unknown };
      const ids = parseUserIds(userIds);
      if (!ids || ids.length === 0) {
        return res.status(400).json({
          error: 'userIds must be a non-empty array of positive integers.',
        });
      }

      const actorId = (req.session as any).userId as number;

      const accounts = await (prisma as any).externalAccount.findMany({
        where: {
          user_id: { in: ids },
          type: { in: ['workspace', 'claude'] },
          status: { in: ['active', 'pending'] },
        },
        select: { id: true, user_id: true, type: true },
      });

      const succeeded: number[] = [];
      const failed: Array<{ accountId: number; userId: number; type: string; error: string }> = [];
      const notifiedUsers = new Set<number>();

      for (const a of accounts) {
        try {
          await prisma.$transaction(async (tx: any) => {
            await req.services.externalAccountLifecycle.suspend(a.id, actorId, tx);
          });
          succeeded.push(a.id);
          notifiedUsers.add(a.user_id);
        } catch (err: any) {
          const message = err instanceof AppError ? err.message : err?.message ?? String(err);
          failed.push({ accountId: a.id, userId: a.user_id, type: a.type, error: message });
        }
      }

      if (succeeded.length > 0) {
        adminBus.notify('users');
        for (const uid of notifiedUsers) userBus.notifyUser(uid);
      }

      const status = failed.length > 0 && succeeded.length > 0 ? 207 : failed.length > 0 ? 207 : 200;
      return res.status(status).json({
        succeeded,
        failed,
        totalEligible: accounts.length,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/users/bulk-revoke-llm-proxy
// Revokes the currently-active LLM proxy token for each listed user.
// Users without an active token are reported as "skipped". Fail-soft.
// ---------------------------------------------------------------------------

adminUsersViewsRouter.post(
  '/users/bulk-revoke-llm-proxy',
  async (req, res, next) => {
    try {
      const { userIds } = (req.body ?? {}) as { userIds?: unknown };
      const ids = parseUserIds(userIds);
      if (!ids || ids.length === 0) {
        return res.status(400).json({
          error: 'userIds must be a non-empty array of positive integers.',
        });
      }

      const actorId = (req.session as any).userId as number;

      const succeeded: number[] = [];
      const skipped: number[] = [];
      const failed: Array<{ userId: number; error: string }> = [];

      for (const userId of ids) {
        try {
          const active = await req.services.llmProxyTokens.getActiveForUser(userId);
          if (!active) {
            skipped.push(userId);
            continue;
          }
          await req.services.llmProxyTokens.revoke(userId, actorId);
          succeeded.push(userId);
          userBus.notifyUser(userId);
        } catch (err: any) {
          const message = err instanceof AppError ? err.message : err?.message ?? String(err);
          failed.push({ userId, error: message });
        }
      }

      if (succeeded.length > 0) {
        adminBus.notify('users');
      }

      const status = failed.length > 0 ? 207 : 200;
      return res.status(status).json({ succeeded, failed, skipped });
    } catch (err) {
      next(err);
    }
  },
);
