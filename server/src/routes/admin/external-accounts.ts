/**
 * Admin external-accounts routes (Sprint 005 T008).
 *
 * All routes are mounted under /admin by the adminRouter in index.ts, so the
 * actual paths are:
 *   POST /admin/external-accounts/:id/suspend
 *   POST /admin/external-accounts/:id/remove
 *
 * requireAuth + requireRole('admin') are applied by the adminRouter before
 * this router is invoked — individual handlers do not re-apply those guards.
 *
 * Error mapping:
 *   AppError subclasses  → their own statusCode
 *   WorkspaceApiError    → 502 (Google Admin SDK failure)
 *   Unknown errors       → fall through to the global errorHandler (500)
 */

import { Router } from 'express';
import { prisma } from '../../services/prisma.js';
import { AppError } from '../../errors.js';
import { WorkspaceApiError } from '../../services/google-workspace/google-workspace-admin.client.js';

export const adminExternalAccountsRouter = Router();

// ---------------------------------------------------------------------------
// POST /admin/external-accounts/:id/suspend
// Calls ExternalAccountLifecycleService.suspend(id, actorId, tx).
// Returns 200 with the updated ExternalAccount on success.
// Returns 404 if the account does not exist.
// Returns 422 if the account is already suspended or removed.
// Returns 502 if a provider API call fails.
// ---------------------------------------------------------------------------

adminExternalAccountsRouter.post('/external-accounts/:id/suspend', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid account id' });
    }
    const actorId = (req.session as any).userId as number;

    const updated = await (prisma as any).$transaction(async (tx: any) => {
      return req.services.externalAccountLifecycle.suspend(id, actorId, tx);
    });

    return res.status(200).json({
      id: updated.id,
      userId: updated.user_id,
      type: updated.type,
      status: updated.status,
      externalId: updated.external_id,
      statusChangedAt: updated.status_changed_at,
      scheduledDeleteAt: updated.scheduled_delete_at ?? null,
    });
  } catch (err: any) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    if (err instanceof WorkspaceApiError) {
      return res.status(502).json({ error: err.message });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/external-accounts/:id/remove
// Calls ExternalAccountLifecycleService.remove(id, actorId, tx).
// Returns 200 with the updated ExternalAccount on success.
// Returns 404 if the account does not exist.
// Returns 422 if the account is already removed.
// Returns 502 if a provider API call fails.
// ---------------------------------------------------------------------------

adminExternalAccountsRouter.post('/external-accounts/:id/remove', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid account id' });
    }
    const actorId = (req.session as any).userId as number;

    const updated = await (prisma as any).$transaction(async (tx: any) => {
      return req.services.externalAccountLifecycle.remove(id, actorId, tx);
    });

    return res.status(200).json({
      id: updated.id,
      userId: updated.user_id,
      type: updated.type,
      status: updated.status,
      externalId: updated.external_id,
      statusChangedAt: updated.status_changed_at,
      scheduledDeleteAt: updated.scheduled_delete_at ?? null,
    });
  } catch (err: any) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    if (err instanceof WorkspaceApiError) {
      return res.status(502).json({ error: err.message });
    }
    next(err);
  }
});
