/**
 * Admin provisioning-requests routes (Sprint 004 T008).
 *
 * All routes are mounted under /admin by the adminRouter in index.ts, so the
 * actual paths are:
 *   GET  /admin/provisioning-requests
 *   POST /admin/provisioning-requests/:id/approve
 *   POST /admin/provisioning-requests/:id/reject
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

export const adminProvisioningRequestsRouter = Router();

// ---------------------------------------------------------------------------
// GET /admin/provisioning-requests
// Returns all pending ProvisioningRequests, joined with the requesting user.
// Response shape per item:
//   { id, userId, userName, userEmail, requestedType, createdAt }
// ---------------------------------------------------------------------------

adminProvisioningRequestsRouter.get('/provisioning-requests', async (req, res, next) => {
  try {
    const rows = await (prisma as any).provisioningRequest.findMany({
      where: { status: 'pending' },
      orderBy: { created_at: 'asc' },
      include: {
        user: {
          select: {
            display_name: true,
            primary_email: true,
          },
        },
      },
    });

    const result = rows.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user.display_name,
      userEmail: row.user.primary_email,
      requestedType: row.requested_type,
      createdAt: row.created_at,
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/provisioning-requests/:id/approve
// Calls ProvisioningRequestService.approve(id, deciderId).
// ---------------------------------------------------------------------------

adminProvisioningRequestsRouter.post('/provisioning-requests/:id/approve', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid request id' });
    }
    const deciderId = (req.session as any).userId as number;

    const rawCohortId = (req.body as { cohortId?: unknown } | undefined)?.cohortId;
    let cohortId: number | undefined;
    if (rawCohortId != null) {
      const n = typeof rawCohortId === 'number' ? rawCohortId : parseInt(String(rawCohortId), 10);
      if (!Number.isInteger(n) || n <= 0) {
        return res.status(400).json({ error: 'Invalid cohortId' });
      }
      cohortId = n;
    }

    const updated = await req.services.provisioningRequests.approve(id, deciderId, { cohortId });

    res.json({
      id: updated.id,
      userId: updated.user_id,
      requestedType: updated.requested_type,
      status: updated.status,
      decidedBy: updated.decided_by,
      decidedAt: updated.decided_at,
      createdAt: updated.created_at,
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
// POST /admin/provisioning-requests/:id/reject
// Calls ProvisioningRequestService.reject(id, deciderId).
// ---------------------------------------------------------------------------

adminProvisioningRequestsRouter.post('/provisioning-requests/:id/reject', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid request id' });
    }
    const deciderId = (req.session as any).userId as number;

    const updated = await req.services.provisioningRequests.reject(id, deciderId);

    res.json({
      id: updated.id,
      userId: updated.user_id,
      requestedType: updated.requested_type,
      status: updated.status,
      decidedBy: updated.decided_by,
      decidedAt: updated.decided_at,
      createdAt: updated.created_at,
    });
  } catch (err: any) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});
