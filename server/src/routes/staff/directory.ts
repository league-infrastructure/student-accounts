import { Router } from 'express';
import { prisma } from '../../services/prisma.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';

export const staffDirectoryRouter = Router();

/**
 * GET /staff/directory
 *
 * Returns a read-only listing of all active students with cohort and
 * external account type information. Requires role=staff (admin is excluded
 * per ticket acceptance criteria T004).
 *
 * Response shape per user:
 *   { id, displayName, email, cohort: {id,name}|null, externalAccountTypes: string[] }
 */
staffDirectoryRouter.get(
  '/staff/directory',
  requireAuth,
  requireRole('staff'),
  async (req, res, next) => {
    try {
      const users = await (prisma as any).user.findMany({
        where: { is_active: true, role: 'student' },
        orderBy: { display_name: 'asc' },
        include: {
          cohort: { select: { id: true, name: true } },
          external_accounts: { select: { type: true } },
        },
      });

      res.json(
        users.map((u: any) => ({
          id: u.id,
          displayName: u.display_name,
          email: u.primary_email,
          createdAt: u.created_at,
          cohort: u.cohort ? { id: u.cohort.id, name: u.cohort.name } : null,
          externalAccountTypes: [...new Set<string>(u.external_accounts.map((a: any) => a.type))],
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);
