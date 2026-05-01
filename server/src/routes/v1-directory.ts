/**
 * v1-directory router — read-only user directory API (Sprint 018).
 *
 * Mounted at /v1 (NOT /api/v1) per architecture-update.md.
 * Both routes protected by oauthBearer('users:read').
 *
 * Endpoints:
 *  GET /v1/users        — paginated user list (id, display_name, primary_email, role, is_active)
 *  GET /v1/users/:id    — single user (adds cohort_id, created_at)
 *
 * Audit: every successful call writes an oauth_directory_call AuditEvent.
 * PII surface: only fields explicitly listed below — no password hashes etc.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { oauthBearer } from '../middleware/oauthBearer.js';
import { prisma } from '../services/prisma.js';

export const v1DirectoryRouter = Router();

// All routes in this file require a valid users:read scoped token.
v1DirectoryRouter.use(oauthBearer('users:read'));

// ---------------------------------------------------------------------------
// GET /v1/users — paginated list
// ---------------------------------------------------------------------------

v1DirectoryRouter.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawPage = parseInt(String(req.query.page ?? '1'), 10);
    const rawPerPage = parseInt(String(req.query.per_page ?? '50'), 10);

    const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const per_page = isNaN(rawPerPage) || rawPerPage < 1 ? 50 : Math.min(rawPerPage, 200);

    const skip = (page - 1) * per_page;

    const [users, total] = await Promise.all([
      (prisma as any).user.findMany({
        skip,
        take: per_page,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          display_name: true,
          primary_email: true,
          role: true,
          is_active: true,
        },
      }),
      (prisma as any).user.count(),
    ]);

    // Audit log — fire-and-forget is fine; don't block the response.
    (prisma as any).auditEvent
      .create({
        data: {
          actor_user_id: null,
          action: 'oauth_directory_call',
          details: {
            path: req.path,
            method: req.method,
            count: users.length,
            client_id: req.oauth?.client_id ?? null,
            scope: 'users:read',
          },
        },
      })
      .catch(() => {}); // best-effort

    res.json({ users, page, per_page, total });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /v1/users/:id — single user detail
// ---------------------------------------------------------------------------

v1DirectoryRouter.get('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await (prisma as any).user.findUnique({
      where: { id },
      select: {
        id: true,
        display_name: true,
        primary_email: true,
        role: true,
        is_active: true,
        cohort_id: true,
        created_at: true,
      },
    });

    const count = user ? 1 : 0;

    // Audit log — fire-and-forget.
    (prisma as any).auditEvent
      .create({
        data: {
          actor_user_id: null,
          action: 'oauth_directory_call',
          details: {
            path: req.path,
            method: req.method,
            count,
            client_id: req.oauth?.client_id ?? null,
            scope: 'users:read',
          },
        },
      })
      .catch(() => {}); // best-effort

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    next(err);
  }
});
