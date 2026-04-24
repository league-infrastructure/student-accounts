/**
 * Admin cohorts routes (Sprint 004 T009).
 *
 * All routes are mounted under /admin by the adminRouter in index.ts, so the
 * actual paths are:
 *   GET  /admin/cohorts
 *   POST /admin/cohorts
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
import { adminBus } from '../../services/change-bus.js';

export const adminCohortsRouter = Router();

// ---------------------------------------------------------------------------
// GET /admin/cohorts
// Returns all Cohorts ordered by created_at descending.
// Response shape per item: { id, name, google_ou_path, createdAt }
// ---------------------------------------------------------------------------

adminCohortsRouter.get('/cohorts', async (_req, res, next) => {
  try {
    const cohorts = await (prisma as any).cohort.findMany({
      orderBy: { created_at: 'desc' },
      include: { _count: { select: { users: true } } },
    });

    const result = cohorts.map((c: any) => ({
      id: c.id,
      name: c.name,
      google_ou_path: c.google_ou_path,
      createdAt: c.created_at,
      memberCount: c._count.users,
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/cohorts
// Accepts { name: string }. Calls CohortService.createWithOU(name, actorId).
// Returns 201 with the new cohort on success.
// Returns 409 if name is duplicate.
// Returns 422 if name is blank.
// Returns 502 if the Admin SDK fails.
// ---------------------------------------------------------------------------

adminCohortsRouter.post('/cohorts', async (req, res, next) => {
  try {
    const { name } = req.body as { name?: unknown };

    if (typeof name !== 'string' || name.trim() === '') {
      return res.status(422).json({ error: 'Cohort name must not be blank.' });
    }

    const actorId = (req.session as any).userId as number;

    const cohort = await req.services.cohorts.createWithOU(name, actorId);

    adminBus.notify('cohorts');

    return res.status(201).json({
      id: cohort.id,
      name: cohort.name,
      google_ou_path: cohort.google_ou_path,
      createdAt: (cohort as any).created_at,
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
