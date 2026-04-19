/**
 * Account routes — endpoints scoped to the signed-in student's own account.
 *
 * Every handler applies requireAuth + requireRole('student').
 * Requests from users with role=staff or role=admin return 403.
 *
 * Routes provided by this module (mounted at /api):
 *   GET  /api/account  — aggregate profile/logins/externalAccounts/provisioningRequests
 *
 * Routes reserved for T003 and T004:
 *   DELETE /api/account/logins/:id
 *   POST   /api/account/provisioning-requests
 *   GET    /api/account/provisioning-requests
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';

export const accountRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/account — aggregate endpoint
// ---------------------------------------------------------------------------

/**
 * Returns the signed-in student's full account data in one response:
 *   profile          — id, displayName, primaryEmail, cohort, role, createdAt
 *   logins           — all Login records for this user
 *   externalAccounts — all ExternalAccount records for this user
 *   provisioningRequests — all ProvisioningRequest records, newest first
 */
accountRouter.get(
  '/account',
  requireAuth,
  requireRole('student'),
  async (req: Request, res: Response) => {
    const userId: number = (req.session as any).userId;
    const { users, cohorts, logins, externalAccounts, provisioningRequests } = req.services;

    // Fetch all four data sources in parallel.
    const [user, userLogins, userAccounts, userRequests] = await Promise.all([
      users.findById(userId),
      logins.findAllByUser(userId),
      externalAccounts.findAllByUser(userId),
      provisioningRequests.findByUser(userId),
    ]);

    // Resolve cohort: null when the user has not been assigned to one yet.
    let cohort: { id: number; name: string } | null = null;
    if (user.cohort_id != null) {
      const cohortRecord = await cohorts.findById(user.cohort_id);
      cohort = { id: cohortRecord.id, name: cohortRecord.name };
    }

    const body = {
      profile: {
        id: user.id,
        displayName: user.display_name,
        primaryEmail: user.primary_email,
        cohort,
        role: user.role,
        createdAt: user.created_at,
      },
      logins: userLogins.map((l) => ({
        id: l.id,
        provider: l.provider,
        providerEmail: l.provider_email ?? null,
        providerUsername: l.provider_username ?? null,
        createdAt: l.created_at,
      })),
      externalAccounts: userAccounts.map((a) => ({
        id: a.id,
        type: a.type,
        status: a.status,
        externalId: a.external_id ?? null,
        createdAt: a.created_at,
      })),
      provisioningRequests: userRequests.map((r) => ({
        id: r.id,
        requestedType: r.requested_type,
        status: r.status,
        createdAt: r.created_at,
        decidedAt: r.decided_at ?? null,
      })),
    };

    res.json(body);
  },
);
