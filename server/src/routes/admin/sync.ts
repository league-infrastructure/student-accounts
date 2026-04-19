/**
 * Admin sync routes (Sprint 006).
 *
 * POST /sync/pike13               — Trigger a Pike13 people sync.
 * POST /sync/workspace/cohorts    — Import Google Workspace student OUs as Cohorts.
 * POST /sync/workspace/staff      — Import Google Workspace staff OU users.
 * POST /sync/workspace/students   — Import Google Workspace student OU users.
 * POST /sync/workspace/all        — Run all three workspace sync operations.
 *
 * All routes return HTTP 200 with the service's report object as JSON on
 * success.  Service errors are caught and mapped:
 *   - WorkspaceApiError (Google Admin SDK failure) → 502
 *   - All other errors → passed to next() → global errorHandler (500)
 *
 * Auth (requireAuth + requireRole('admin')) is applied by the parent adminRouter
 * in routes/admin/index.ts — individual handlers do not re-apply those guards.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { WorkspaceApiError } from '../../services/google-workspace/google-workspace-admin.client.js';

export const adminSyncRouter = Router();

// ---------------------------------------------------------------------------
// POST /sync/pike13
// ---------------------------------------------------------------------------

/**
 * POST /sync/pike13
 *
 * Triggers a full Pike13 people sync and returns the SyncReport.
 * Auth is handled by the parent router middleware.
 */
adminSyncRouter.post(
  '/sync/pike13',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const report = await req.services.pike13Sync.sync();
      res.status(200).json(report);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /sync/workspace/cohorts
// ---------------------------------------------------------------------------

/**
 * POST /sync/workspace/cohorts
 *
 * Imports Google Workspace student OUs as Cohort rows.
 * Returns WorkspaceSyncReport with cohortsUpserted count.
 */
adminSyncRouter.post(
  '/sync/workspace/cohorts',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actorId = (req.session as any).userId as number;
      const report = await req.services.workspaceSync.syncCohorts(actorId);
      res.status(200).json(report);
    } catch (err) {
      if (err instanceof WorkspaceApiError) {
        res.status(502).json({ error: (err as Error).message });
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /sync/workspace/staff
// ---------------------------------------------------------------------------

/**
 * POST /sync/workspace/staff
 *
 * Imports Google Workspace staff OU users as staff User rows.
 * Returns WorkspaceSyncReport with staffUpserted count.
 */
adminSyncRouter.post(
  '/sync/workspace/staff',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actorId = (req.session as any).userId as number;
      const report = await req.services.workspaceSync.syncStaff(actorId);
      res.status(200).json(report);
    } catch (err) {
      if (err instanceof WorkspaceApiError) {
        res.status(502).json({ error: (err as Error).message });
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /sync/workspace/students
// ---------------------------------------------------------------------------

/**
 * POST /sync/workspace/students
 *
 * Imports Google Workspace student OU users as student User rows.
 * Returns WorkspaceSyncReport with studentsUpserted count and flaggedAccounts.
 */
adminSyncRouter.post(
  '/sync/workspace/students',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actorId = (req.session as any).userId as number;
      const report = await req.services.workspaceSync.syncStudents(actorId);
      res.status(200).json(report);
    } catch (err) {
      if (err instanceof WorkspaceApiError) {
        res.status(502).json({ error: (err as Error).message });
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /sync/workspace/all
// ---------------------------------------------------------------------------

/**
 * POST /sync/workspace/all
 *
 * Runs syncCohorts → syncStaff → syncStudents in sequence, continuing past
 * individual sub-operation failures (fail-soft).
 * Returns combined WorkspaceSyncReport.
 */
adminSyncRouter.post(
  '/sync/workspace/all',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actorId = (req.session as any).userId as number;
      const report = await req.services.workspaceSync.syncAll(actorId);
      res.status(200).json(report);
    } catch (err) {
      if (err instanceof WorkspaceApiError) {
        res.status(502).json({ error: (err as Error).message });
        return;
      }
      next(err);
    }
  },
);
