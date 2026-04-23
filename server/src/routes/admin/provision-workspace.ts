/**
 * POST /api/admin/users/:id/provision-workspace
 *
 * On-demand Workspace account provisioning for a student, called directly
 * from the Admin User Detail page (Sprint 010 T004). This mirrors the
 * provision-claude handler added in Sprint 005.
 *
 * Mounted under /admin by the adminRouter in index.ts.
 * requireAuth + requireRole('admin') are applied by the adminRouter before
 * this router is invoked.
 *
 * Error mapping:
 *   AppError subclasses (UnprocessableError/ConflictError) → their own statusCode
 *   WorkspaceApiError / WorkspaceDomainGuardError / WorkspaceWriteDisabledError → 502
 *   Unknown errors → fall through to the global errorHandler (500)
 */

import { Router } from 'express';
import { prisma } from '../../services/prisma.js';
import { AppError } from '../../errors.js';
import { WorkspaceApiError } from '../../services/google-workspace/google-workspace-admin.client.js';

export const adminProvisionWorkspaceRouter = Router();

// ---------------------------------------------------------------------------
// POST /admin/users/:id/provision-workspace
// Calls WorkspaceProvisioningService.provision(userId, actorId, tx) inside a
// prisma.$transaction. Returns 201 with the new ExternalAccount on success.
// Returns 404 if the user does not exist.
// Returns 409 if the user already has an active/pending workspace ExternalAccount.
// Returns 422 if the user is not role=student.
// Returns 422 if the user has no cohort assigned.
// Returns 502 on Google Workspace API error.
// ---------------------------------------------------------------------------

adminProvisionWorkspaceRouter.post('/users/:id/provision-workspace', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const actorId = (req.session as any).userId as number;

    const account = await (prisma as any).$transaction(async (tx: any) => {
      return req.services.workspaceProvisioning.provision(userId, actorId, tx);
    });

    return res.status(201).json({
      id: account.id,
      userId: account.user_id,
      type: account.type,
      status: account.status,
      externalId: account.external_id,
      statusChangedAt: account.status_changed_at,
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
