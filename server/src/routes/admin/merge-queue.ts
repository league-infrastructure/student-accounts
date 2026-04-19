/**
 * Admin merge-queue routes (Sprint 007 T005).
 *
 * All routes are mounted under /admin by the adminRouter in index.ts, so the
 * actual paths are:
 *   GET  /admin/merge-queue
 *   GET  /admin/merge-queue/:id
 *   POST /admin/merge-queue/:id/approve
 *   POST /admin/merge-queue/:id/reject
 *   POST /admin/merge-queue/:id/defer
 *
 * requireAuth + requireRole('admin') are applied by the adminRouter before
 * this router is invoked — individual handlers do not re-apply those guards.
 *
 * Error mapping:
 *   NotFoundError        → 404
 *   MergeConflictError   → 409
 *   AppError subclasses  → their own statusCode
 *   Unknown errors       → fall through to the global errorHandler (500)
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../errors.js';
import { MergeConflictError } from '../../services/merge-suggestion.service.js';

export const adminMergeQueueRouter = Router();

// ---------------------------------------------------------------------------
// GET /admin/merge-queue
// Returns all pending + deferred MergeSuggestions with lightweight user info.
// ---------------------------------------------------------------------------

adminMergeQueueRouter.get(
  '/merge-queue',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const items = await req.services.mergeSuggestions.findQueueItems();
      res.status(200).json(items);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/merge-queue/:id
// Returns a single suggestion with full user data (Logins, ExternalAccounts).
// ---------------------------------------------------------------------------

adminMergeQueueRouter.get(
  '/merge-queue/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid suggestion id' });
        return;
      }
      const detail = await req.services.mergeSuggestions.findDetailById(id);
      res.status(200).json(detail);
    } catch (err: any) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/merge-queue/:id/approve
// Body: { survivorId: number }
// Calls MergeSuggestionService.approve(id, survivorId, actorId).
// ---------------------------------------------------------------------------

adminMergeQueueRouter.post(
  '/merge-queue/:id/approve',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid suggestion id' });
        return;
      }

      const { survivorId } = req.body as { survivorId?: unknown };
      if (typeof survivorId !== 'number') {
        res.status(400).json({ error: 'survivorId must be a number' });
        return;
      }

      const actorId = (req.session as any).userId as number;
      await req.services.mergeSuggestions.approve(id, survivorId, actorId);
      res.status(200).json({ ok: true });
    } catch (err: any) {
      if (err instanceof MergeConflictError) {
        // survivorId not part of pair → 400; already decided → 409
        const isAlreadyDecided =
          err.message.includes('already approved') ||
          err.message.includes('already rejected');
        if (isAlreadyDecided) {
          res.status(409).json({ error: err.message });
        } else {
          res.status(400).json({ error: err.message });
        }
        return;
      }
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/merge-queue/:id/reject
// Calls MergeSuggestionService.reject(id, actorId).
// ---------------------------------------------------------------------------

adminMergeQueueRouter.post(
  '/merge-queue/:id/reject',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid suggestion id' });
        return;
      }
      const actorId = (req.session as any).userId as number;
      await req.services.mergeSuggestions.reject(id, actorId);
      res.status(200).json({ ok: true });
    } catch (err: any) {
      if (err instanceof MergeConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/merge-queue/:id/defer
// Calls MergeSuggestionService.defer(id).
// ---------------------------------------------------------------------------

adminMergeQueueRouter.post(
  '/merge-queue/:id/defer',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid suggestion id' });
        return;
      }
      await req.services.mergeSuggestions.defer(id);
      res.status(200).json({ ok: true });
    } catch (err: any) {
      if (err instanceof MergeConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      next(err);
    }
  },
);
