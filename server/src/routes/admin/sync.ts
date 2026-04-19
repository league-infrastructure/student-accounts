/**
 * Admin sync routes (Sprint 006).
 *
 * POST /sync/pike13 — Trigger a Pike13 people sync.
 *   Returns 200 with a SyncReport JSON body on success.
 *   Protected by requireAuth + requireRole('admin') (applied by the parent
 *   adminRouter in routes/admin/index.ts).
 *
 * Ticket 007 may extend this file with additional sync endpoints.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';

export const adminSyncRouter = Router();

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
