/**
 * Admin user-logins routes (Sprint 005 T010).
 *
 * All routes are mounted under /admin by the adminRouter in index.ts, so the
 * actual paths are:
 *   POST   /admin/users/:id/logins
 *   DELETE /admin/users/:id/logins/:loginId
 *
 * requireAuth + requireRole('admin') are applied by the adminRouter before
 * this router is invoked — individual handlers do not re-apply those guards.
 *
 * Error mapping:
 *   AppError subclasses  → their own statusCode (ConflictError→409, NotFoundError→404,
 *                          ValidationError→422)
 *   Unknown errors       → fall through to the global errorHandler (500)
 */

import { Router } from 'express';
import { AppError } from '../../errors.js';
import * as pike13Writeback from '../../services/pike13/pike13-writeback.service.js';
import { ExternalAccountRepository } from '../../services/repositories/external-account.repository.js';
import { prisma } from '../../services/prisma.js';

export const adminUserLoginsRouter = Router();

// ---------------------------------------------------------------------------
// POST /admin/users/:id/logins
// Body: { provider, providerUserId, providerEmail?, providerUsername? }
// Creates a Login record via LoginService. If provider=github, calls the
// Pike13 write-back stub after successful creation.
// Returns 201 with the created Login record.
// ---------------------------------------------------------------------------

adminUserLoginsRouter.post('/users/:id/logins', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const { provider, providerUserId, providerEmail, providerUsername } = req.body ?? {};

    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: 'provider is required' });
    }
    if (!providerUserId || typeof providerUserId !== 'string') {
      return res.status(400).json({ error: 'providerUserId is required' });
    }

    const actorId = (req.session as any).userId as number;

    const login = await req.services.logins.create(
      userId,
      provider,
      providerUserId,
      providerEmail ?? null,
      actorId,
      providerUsername ?? null,
    );

    // Pike13 write-back — only for GitHub logins.
    // Only call if the user has a pike13 ExternalAccount (any status).
    if (provider === 'github') {
      const pike13Account = await ExternalAccountRepository.findActiveByUserAndType(
        prisma,
        userId,
        'pike13',
      );
      if (pike13Account) {
        const handle = providerUsername ?? providerUserId;
        await pike13Writeback.githubHandle(userId, handle);
      }
    }

    res.status(201).json(serializeLogin(login));
  } catch (err: any) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id/logins/:loginId
// Removes a Login via LoginService. Rejects with 422 if it is the last login
// for the user. Rejects with 404 if the login does not exist or does not
// belong to the specified user.
// Returns 204 on success.
// ---------------------------------------------------------------------------

adminUserLoginsRouter.delete('/users/:id/logins/:loginId', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const loginId = parseInt(req.params.loginId, 10);

    if (isNaN(userId) || isNaN(loginId)) {
      return res.status(400).json({ error: 'Invalid user id or login id' });
    }

    // Verify the login exists and belongs to this user.
    const login = await req.services.logins.findById(loginId);
    if (!login || login.user_id !== userId) {
      return res.status(404).json({ error: 'Login not found for this user' });
    }

    const actorId = (req.session as any).userId as number;

    await req.services.logins.delete(loginId, actorId);

    res.status(204).end();
  } catch (err: any) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeLogin(login: any) {
  return {
    id: login.id,
    userId: login.user_id,
    provider: login.provider,
    providerUserId: login.provider_user_id,
    providerEmail: login.provider_email ?? null,
    providerUsername: login.provider_username ?? null,
    createdAt: login.created_at,
  };
}
