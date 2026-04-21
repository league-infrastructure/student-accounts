/**
 * Admin audit-log route — GET /admin/audit-log with filters and pagination.
 *
 * GET /admin/audit-log
 *   Query params (all optional):
 *     actorId       — integer, filter by actor_user_id
 *     targetUserId  — integer, filter by target_user_id
 *     action        — string, filter by action
 *     from          — ISO date string (inclusive lower bound on created_at)
 *     to            — ISO date string (inclusive upper bound on created_at)
 *     page          — integer >= 1, default 1
 *     pageSize      — integer 1–200, default 50
 *
 *   Response: { total, page, pageSize, items: [...] }
 *   Items ordered by created_at DESC with actorName/targetUserName resolved.
 *
 * Auth enforced upstream by adminRouter (requireAuth + requireRole('admin')).
 */

import { Router } from 'express';
import { prisma } from '../../services/prisma.js';

export const adminAuditLogRouter = Router();

adminAuditLogRouter.get('/audit-log', async (req, res, next) => {
  try {
    // --- Parse and validate query params ---

    const rawActorId = req.query.actorId as string | undefined;
    const rawTargetUserId = req.query.targetUserId as string | undefined;
    const rawPage = (req.query.page as string | undefined) ?? '1';
    const rawPageSize = (req.query.pageSize as string | undefined) ?? '50';
    const rawFrom = req.query.from as string | undefined;
    const rawTo = req.query.to as string | undefined;
    const action = req.query.action as string | undefined;

    // Validate and parse actorId
    let actorId: number | undefined;
    if (rawActorId !== undefined) {
      const parsed = parseInt(rawActorId, 10);
      if (isNaN(parsed)) {
        return res.status(400).json({ error: 'Invalid actorId: must be an integer' });
      }
      actorId = parsed;
    }

    // Validate and parse targetUserId
    let targetUserId: number | undefined;
    if (rawTargetUserId !== undefined) {
      const parsed = parseInt(rawTargetUserId, 10);
      if (isNaN(parsed)) {
        return res.status(400).json({ error: 'Invalid targetUserId: must be an integer' });
      }
      targetUserId = parsed;
    }

    // Validate and parse page
    const page = parseInt(rawPage, 10);
    if (isNaN(page) || page < 1) {
      return res.status(400).json({ error: 'Invalid page: must be a positive integer' });
    }

    // Validate and parse pageSize
    const pageSize = parseInt(rawPageSize, 10);
    if (isNaN(pageSize) || pageSize < 1) {
      return res.status(400).json({ error: 'Invalid pageSize: must be a positive integer' });
    }
    const clampedPageSize = Math.min(200, pageSize);

    // Validate and parse from
    let from: Date | undefined;
    if (rawFrom !== undefined) {
      from = new Date(rawFrom);
      if (isNaN(from.getTime())) {
        return res.status(400).json({ error: 'Invalid from: must be an ISO date string' });
      }
    }

    // Validate and parse to
    let to: Date | undefined;
    if (rawTo !== undefined) {
      to = new Date(rawTo);
      if (isNaN(to.getTime())) {
        return res.status(400).json({ error: 'Invalid to: must be an ISO date string' });
      }
    }

    // --- Build where clause ---
    const where: Record<string, unknown> = {};
    if (actorId !== undefined) where.actor_user_id = actorId;
    if (targetUserId !== undefined) where.target_user_id = targetUserId;
    if (action) where.action = action;
    if (from !== undefined || to !== undefined) {
      where.created_at = {
        ...(from !== undefined && { gte: from }),
        ...(to !== undefined && { lte: to }),
      };
    }

    // --- Query ---
    const [total, events] = await (prisma as any).$transaction([
      (prisma as any).auditEvent.count({ where }),
      (prisma as any).auditEvent.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * clampedPageSize,
        take: clampedPageSize,
        include: {
          actor: { select: { display_name: true } },
          target: { select: { display_name: true } },
        },
      }),
    ]);

    // --- Serialize ---
    res.json({
      total,
      page,
      pageSize: clampedPageSize,
      items: events.map((e: any) => ({
        id: e.id,
        createdAt: e.created_at,
        actorId: e.actor_user_id,
        actorName: e.actor?.display_name ?? null,
        action: e.action,
        targetUserId: e.target_user_id,
        targetUserName: e.target?.display_name ?? null,
        targetEntityType: e.target_entity_type,
        targetEntityId: e.target_entity_id,
        details: e.details,
      })),
    });
  } catch (err) {
    next(err);
  }
});
