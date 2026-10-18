/**
 * Admin laptop roster routes (sprint 002 "laptop accounts" T004, SUC-007).
 *
 * POST /laptop/push-all — Reconcile every user who has a username against
 *                         the laptop roster. Returns the PushAllResult
 *                         counts ({ written, locked, unchanged, skipped,
 *                         failed }) and records a `laptop_push_all` audit
 *                         event. 503 when the roster bucket is not
 *                         configured (nothing is touched in that case).
 *
 * Auth (requireAuth + requireRole('admin')) is applied by the parent
 * adminRouter in routes/admin/index.ts.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../../services/prisma.js';
import {
  LaptopRosterNotConfiguredError,
  UnconfiguredLaptopRosterClient,
} from '../../services/laptop/laptop-roster.client.js';

export const adminLaptopRouter = Router();

adminLaptopRouter.post(
  '/laptop/push-all',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const actorId = (req.session as any).userId as number;

    // Refuse up front rather than marking every user dirty against a roster
    // that cannot be reached by construction.
    if (req.services.laptopRoster instanceof UnconfiguredLaptopRosterClient) {
      res.status(503).json({ error: new LaptopRosterNotConfiguredError().message });
      return;
    }

    try {
      const result = await req.services.laptopAccounts.pushAll(actorId);
      await prisma.$transaction(async (tx: any) => {
        await req.services.audit.record(tx, {
          actor_user_id: actorId,
          action: 'laptop_push_all',
          details: { ...result },
        });
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
