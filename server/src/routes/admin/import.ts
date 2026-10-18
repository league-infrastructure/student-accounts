/**
 * Admin import routes (sprint 002 "laptop accounts" T003).
 *
 * POST /import/laptop-roster   — One-time import of the laptop roster into a
 *                                group (default "Botball 26"). Body
 *                                `{ groupName?: string }`. Returns the
 *                                ImportReport; 503 when the roster bucket is
 *                                not configured.
 *
 * Auth (requireAuth + requireRole('admin')) is applied by the parent
 * adminRouter in routes/admin/index.ts.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { LaptopRosterNotConfiguredError } from '../../services/laptop/laptop-roster.client.js';
import { DEFAULT_IMPORT_GROUP_NAME } from '../../services/laptop/laptop-roster-import.service.js';

export const adminImportRouter = Router();

adminImportRouter.post(
  '/import/laptop-roster',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const raw = (req.body ?? {}).groupName;
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      res.status(400).json({ error: 'groupName must be a string' });
      return;
    }
    const groupName = (raw ?? '').trim() || DEFAULT_IMPORT_GROUP_NAME;
    const actorId = (req.session as any).userId as number;

    try {
      const report = await req.services.laptopRosterImport.importAll(actorId, { groupName });
      res.status(200).json(report);
    } catch (err) {
      if (err instanceof LaptopRosterNotConfiguredError) {
        res.status(503).json({ error: err.message });
        return;
      }
      next(err);
    }
  },
);
