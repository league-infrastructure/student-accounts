/**
 * Account routes — endpoints scoped to the signed-in student's own account.
 *
 * Every handler applies requireAuth + requireRole('student').
 * Requests from users with role=staff or role=admin return 403.
 *
 * Routes provided by this module (mounted at /api):
 *   GET    /api/account               — aggregate profile/logins/externalAccounts/provisioningRequests
 *   DELETE /api/account/logins/:id    — remove one of the student's own Logins
 *
 * Routes reserved for T004:
 *   POST   /api/account/provisioning-requests
 *   GET    /api/account/provisioning-requests
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';

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

// ---------------------------------------------------------------------------
// DELETE /api/account/logins/:id — remove one of the student's own Logins
// ---------------------------------------------------------------------------

/**
 * Removes a Login that belongs to the signed-in student.
 *
 * Ownership scope: the Login must have login.user_id === session.userId.
 * If the ID does not exist or belongs to another user, returns 404 (to avoid
 * revealing cross-user login IDs).
 *
 * At-least-one guard: LoginService.delete throws ValidationError when the
 * deletion would leave the user with zero logins. The route maps this to 409.
 *
 * The delete and its audit event (remove_login) are written atomically by
 * LoginService.delete.
 */
accountRouter.delete(
  '/account/logins/:id',
  requireAuth,
  requireRole('student'),
  async (req: Request, res: Response, next: NextFunction) => {
    const userId: number = (req.session as any).userId;
    const loginId = parseInt(req.params.id, 10);

    if (isNaN(loginId)) {
      return next(new NotFoundError('Login not found'));
    }

    const { logins } = req.services;

    // Ownership check: load the Login and confirm it belongs to this user.
    // Return 404 whether the record is missing or belongs to another user, to
    // avoid revealing that the ID exists.
    const login = await logins.findById(loginId);
    if (!login || login.user_id !== userId) {
      return next(new NotFoundError('Login not found'));
    }

    try {
      await logins.delete(loginId, userId);
    } catch (err) {
      if (err instanceof ValidationError) {
        // Map "would leave zero logins" → 409 Conflict per UC-011.
        return next(new ConflictError('Cannot remove the last login'));
      }
      return next(err);
    }

    res.status(204).end();
  },
);
