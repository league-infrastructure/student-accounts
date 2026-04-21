/**
 * Admin stats route (Sprint 010 T003).
 *
 * Mounted under /admin by adminRouter in index.ts. Actual path:
 *   GET /admin/stats
 *
 * requireAuth + requireRole('admin') are enforced by adminRouter before
 * this router is invoked — no per-handler guards needed.
 *
 * Returns aggregate counts used by the admin Dashboard:
 *   { totalStudents, totalStaff, totalAdmins, pendingRequests,
 *     openMergeSuggestions, cohortCount }
 */

import { Router } from 'express';
import { prisma } from '../../services/prisma.js';

export const adminStatsRouter = Router();

// ---------------------------------------------------------------------------
// GET /admin/stats
// Returns role-count and queue-depth aggregates. All counts are integers.
// ---------------------------------------------------------------------------

adminStatsRouter.get('/stats', async (_req, res, next) => {
  try {
    const [students, staff, admins, pendingRequests, openMergeSuggestions, cohortCount] =
      await Promise.all([
        (prisma as any).user.count({ where: { role: 'student', is_active: true } }),
        (prisma as any).user.count({ where: { role: 'staff',   is_active: true } }),
        (prisma as any).user.count({ where: { role: 'admin',   is_active: true } }),
        (prisma as any).provisioningRequest.count({ where: { status: 'pending' } }),
        (prisma as any).mergeSuggestion.count({ where: { status: 'pending' } }),
        (prisma as any).cohort.count(),
      ]);

    res.json({
      totalStudents: students,
      totalStaff: staff,
      totalAdmins: admins,
      pendingRequests,
      openMergeSuggestions,
      cohortCount,
    });
  } catch (err) {
    next(err);
  }
});
