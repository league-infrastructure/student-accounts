/**
 * Admin laptop roster routes (sprint 002 "laptop accounts" T004/T006, SUC-007).
 *
 * POST /laptop/push-all        — Reconcile every user who has a username
 *                                against the laptop roster. Returns the
 *                                PushAllResult counts ({ written, locked,
 *                                unchanged, skipped, failed }) and records a
 *                                `laptop_push_all` audit event. 503 when the
 *                                roster bucket is not configured (nothing is
 *                                touched in that case).
 * POST /users/:id/laptop/push  — "Push now" for one user: reconcile their
 *                                entry and return { outcome, laptopLogin }
 *                                (the ReconcileOutcome and the state the
 *                                detail card shows). 400 bad id, 404 unknown
 *                                user, 503 when not configured. A failed
 *                                write is a 200 with outcome 'failed': the
 *                                user is marked dirty for the hourly job.
 *
 * Auth (requireAuth + requireRole('admin')) is applied by the parent
 * adminRouter in routes/admin/index.ts.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../../services/prisma.js';
import { UserRepository } from '../../services/repositories/user.repository.js';
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

adminLaptopRouter.post(
  '/users/:id/laptop/push',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const userId = parseInt(raw, 10);
      if (!Number.isFinite(userId) || userId <= 0) {
        res.status(400).json({ error: 'Invalid user id' });
        return;
      }
      const actorId = (req.session as any).userId as number;

      if (req.services.laptopRoster instanceof UnconfiguredLaptopRosterClient) {
        res.status(503).json({ error: new LaptopRosterNotConfiguredError().message });
        return;
      }

      const before = await UserRepository.findByIdIncludingInactive(prisma, userId);
      if (!before) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const outcome = await req.services.laptopAccounts.reconcile(userId, actorId);

      // Re-read: reconcile flips laptop_roster_dirty either way.
      const after = (await UserRepository.findByIdIncludingInactive(prisma, userId)) ?? before;
      const lastWritten = await req.services.laptopAccounts.lastWrittenAt(userId);
      const laptopLogin = req.services.laptopAccounts.stateFor(after as any);
      res.status(200).json({
        outcome,
        laptopLogin: lastWritten ? { ...laptopLogin, lastWritten } : laptopLogin,
      });
    } catch (err) {
      next(err);
    }
  },
);
