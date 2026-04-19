/**
 * Admin bulk-cohort routes — preview, bulk-suspend, bulk-remove (Sprint 008 T002).
 *
 * GET  /admin/cohorts/:id/bulk-preview?accountType=workspace|claude&operation=suspend|remove
 *   Returns { eligibleCount: number } (200).
 *
 * POST /admin/cohorts/:id/bulk-suspend   body: { accountType: 'workspace' | 'claude' }
 *   Calls BulkCohortService.suspendCohort. Returns { succeeded, failed }.
 *
 * POST /admin/cohorts/:id/bulk-remove    body: { accountType: 'workspace' | 'claude' }
 *   Calls BulkCohortService.removeCohort. Returns { succeeded, failed }.
 *
 * HTTP status:
 *   200  — all accounts succeeded (including zero-eligible).
 *   207  — at least one failed and at least one succeeded.
 *   400  — missing or invalid accountType / operation query param.
 *   404  — cohort not found (service throws NotFoundError).
 *   500  — unexpected errors (falls through to global errorHandler).
 *
 * Auth enforced upstream by adminRouter (requireAuth + requireRole('admin')).
 */

import { Router } from 'express';
import { AppError } from '../../errors.js';
import type { AccountType } from '../../services/bulk-cohort.service.js';

export const adminBulkCohortRouter = Router();

const VALID_ACCOUNT_TYPES: AccountType[] = ['workspace', 'claude'];
const VALID_OPERATIONS = ['suspend', 'remove'] as const;

// ---------------------------------------------------------------------------
// GET /admin/cohorts/:id/bulk-preview
// ---------------------------------------------------------------------------

adminBulkCohortRouter.get('/cohorts/:id/bulk-preview', async (req, res, next) => {
  try {
    const cohortId = parseInt(req.params.id, 10);
    if (isNaN(cohortId)) {
      return res.status(400).json({ error: 'Invalid cohort id' });
    }

    const { accountType, operation } = req.query as Record<string, string>;

    if (!accountType || !VALID_ACCOUNT_TYPES.includes(accountType as AccountType)) {
      return res.status(400).json({
        error: `Missing or invalid accountType; must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`,
      });
    }

    if (!operation || !VALID_OPERATIONS.includes(operation as (typeof VALID_OPERATIONS)[number])) {
      return res.status(400).json({
        error: `Missing or invalid operation; must be one of: ${VALID_OPERATIONS.join(', ')}`,
      });
    }

    const eligibleCount = await req.services.bulkCohort.previewCount(
      cohortId,
      accountType as AccountType,
      operation as (typeof VALID_OPERATIONS)[number],
    );

    return res.status(200).json({ eligibleCount });
  } catch (err: any) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/cohorts/:id/bulk-suspend
// ---------------------------------------------------------------------------

adminBulkCohortRouter.post('/cohorts/:id/bulk-suspend', async (req, res, next) => {
  try {
    const cohortId = parseInt(req.params.id, 10);
    if (isNaN(cohortId)) {
      return res.status(400).json({ error: 'Invalid cohort id' });
    }

    const { accountType } = req.body as { accountType?: string };

    if (!accountType || !VALID_ACCOUNT_TYPES.includes(accountType as AccountType)) {
      return res.status(400).json({
        error: `Missing or invalid accountType; must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`,
      });
    }

    const actorId = (req.session as any).userId as number;

    const result = await req.services.bulkCohort.suspendCohort(
      cohortId,
      accountType as AccountType,
      actorId,
    );

    const status = result.failed.length > 0 && result.succeeded.length > 0 ? 207 : 200;
    return res.status(status).json(result);
  } catch (err: any) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/cohorts/:id/bulk-remove
// ---------------------------------------------------------------------------

adminBulkCohortRouter.post('/cohorts/:id/bulk-remove', async (req, res, next) => {
  try {
    const cohortId = parseInt(req.params.id, 10);
    if (isNaN(cohortId)) {
      return res.status(400).json({ error: 'Invalid cohort id' });
    }

    const { accountType } = req.body as { accountType?: string };

    if (!accountType || !VALID_ACCOUNT_TYPES.includes(accountType as AccountType)) {
      return res.status(400).json({
        error: `Missing or invalid accountType; must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`,
      });
    }

    const actorId = (req.session as any).userId as number;

    const result = await req.services.bulkCohort.removeCohort(
      cohortId,
      accountType as AccountType,
      actorId,
    );

    const status = result.failed.length > 0 && result.succeeded.length > 0 ? 207 : 200;
    return res.status(status).json(result);
  } catch (err: any) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});
