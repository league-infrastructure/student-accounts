/**
 * Account routes — endpoints scoped to the signed-in student's own account.
 *
 * Every handler applies requireAuth + requireRole('student').
 * Requests from users with role=staff or role=admin return 403.
 *
 * Routes provided by this module (mounted at /api):
 *   GET    /api/account               — aggregate profile/logins/externalAccounts/provisioningRequests
 *   DELETE /api/account/logins/:id    — remove one of the student's own Logins
 *   POST   /api/account/provisioning-requests — create one or two provisioning request rows
 *   GET    /api/account/provisioning-requests — list the signed-in student's requests (newest first)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../services/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { ConflictError, NotFoundError, UnprocessableError, ValidationError } from '../errors.js';
import type { CreateRequestType } from '../services/provisioning-request.service.js';
import { adminBus } from '../services/change-bus.js';

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

    // Temp password for the welcome flow. Only surfaced to the student
    // when they have a live workspace ExternalAccount — no reason for
    // someone without one to see a value they can't use.
    const hasLiveWorkspace = userAccounts.some(
      (a) => a.type === 'workspace' && (a.status === 'active' || a.status === 'pending'),
    );
    const workspaceTempPassword = hasLiveWorkspace
      ? (process.env.GOOGLE_WORKSPACE_TEMP_PASSWORD ?? null)
      : null;

    const body = {
      profile: {
        id: user.id,
        displayName: user.display_name,
        primaryEmail: user.primary_email,
        cohort,
        role: user.role,
        approvalStatus: (user as any).approval_status ?? 'approved',
        createdAt: user.created_at,
        workspaceTempPassword,
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
    const loginId = parseInt(req.params.id as string, 10);

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

// ---------------------------------------------------------------------------
// Valid request types accepted by the POST endpoint.
// 'claude' alone is valid at the HTTP layer; the service enforces the
// workspace-baseline constraint.
// ---------------------------------------------------------------------------

const VALID_REQUEST_TYPES: CreateRequestType[] = ['workspace', 'claude', 'workspace_and_claude'];

// ---------------------------------------------------------------------------
// POST /api/account/provisioning-requests — create a provisioning request
// ---------------------------------------------------------------------------

/**
 * Creates one or two ProvisioningRequest rows on behalf of the signed-in
 * student by delegating entirely to ProvisioningRequestService.create.
 *
 * Body: { requestType: "workspace" | "claude" | "workspace_and_claude" }
 *
 * 201 — one or two request objects created.
 * 400 — requestType is missing or not one of the valid values.
 * 409 — ConflictError: a pending/active workspace account or request already exists.
 * 422 — UnprocessableError: claude requested without a workspace baseline.
 * 401 — not authenticated.
 * 403 — role is not 'student'.
 */
accountRouter.post(
  '/account/provisioning-requests',
  requireAuth,
  requireRole('student'),
  async (req: Request, res: Response, next: NextFunction) => {
    const userId: number = (req.session as any).userId;
    const { requestType } = req.body;

    // Validate requestType before touching the service.
    if (!requestType || !VALID_REQUEST_TYPES.includes(requestType as CreateRequestType)) {
      return res.status(400).json({
        error: `Invalid requestType. Must be one of: ${VALID_REQUEST_TYPES.join(', ')}.`,
      });
    }

    // Pending-approval users can't request services yet.
    const self = await prisma.user.findUnique({ where: { id: userId } });
    if (self?.approval_status === 'pending') {
      return res.status(403).json({
        error: 'Your account is awaiting admin approval. You cannot request services yet.',
      });
    }

    const { provisioningRequests } = req.services;

    try {
      const created = await provisioningRequests.create(userId, requestType as CreateRequestType, userId);

      // Serialize: snake_case DB fields → camelCase HTTP response.
      const body = created.map((r) => ({
        id: r.id,
        requestedType: r.requested_type,
        status: r.status,
        createdAt: r.created_at,
        decidedAt: r.decided_at ?? null,
      }));

      adminBus.notify('pending-requests');

      res.status(201).json(body);
    } catch (err) {
      if (err instanceof ConflictError) {
        return next(err); // 409
      }
      if (err instanceof UnprocessableError) {
        return next(err); // 422
      }
      return next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/account/provisioning-requests — list student's provisioning requests
// ---------------------------------------------------------------------------

/**
 * Returns all ProvisioningRequest rows for the signed-in student,
 * ordered most-recent-first.
 *
 * 200 — array of provisioning request objects (may be empty).
 * 401 — not authenticated.
 * 403 — role is not 'student'.
 */
// ---------------------------------------------------------------------------
// PATCH /api/account/profile — self-service profile edit
// ---------------------------------------------------------------------------
//
// Accepts { displayName } and writes it to the signed-in user's row. The
// only editable field for now. No role gate — every authenticated user
// can rename themselves.
accountRouter.patch(
  '/account/profile',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId: number = (req.session as any).userId;
      const raw = (req.body as { displayName?: unknown } | undefined)?.displayName;
      const displayName = typeof raw === 'string' ? raw.trim() : '';
      if (displayName.length === 0 || displayName.length > 120) {
        return res
          .status(400)
          .json({ error: 'displayName must be a non-empty string under 120 characters' });
      }
      await prisma.user.update({
        where: { id: userId },
        data: { display_name: displayName },
      });
      res.json({ ok: true, displayName });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/account/complete-onboarding — one-time setup step for new users
// ---------------------------------------------------------------------------
//
// Called by the Onboarding page. Accepts { displayName } in the body and
// writes it to the signed-in user's row along with onboarding_completed=true.
// No role gate — League-identity users skip this path entirely (their
// onboarding_completed is created as true), so in practice only newly
// created external-identity students hit this.
accountRouter.post(
  '/account/complete-onboarding',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId: number = (req.session as any).userId;
      const raw = (req.body as { displayName?: unknown } | undefined)?.displayName;
      const displayName = typeof raw === 'string' ? raw.trim() : '';
      if (displayName.length === 0 || displayName.length > 120) {
        return res
          .status(400)
          .json({ error: 'displayName must be a non-empty string under 120 characters' });
      }
      await prisma.user.update({
        where: { id: userId },
        data: { display_name: displayName, onboarding_completed: true },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

accountRouter.get(
  '/account/provisioning-requests',
  requireAuth,
  requireRole('student'),
  async (req: Request, res: Response) => {
    const userId: number = (req.session as any).userId;
    const { provisioningRequests } = req.services;

    const requests = await provisioningRequests.findByUser(userId);

    const body = requests.map((r) => ({
      id: r.id,
      requestedType: r.requested_type,
      status: r.status,
      createdAt: r.created_at,
      decidedAt: r.decided_at ?? null,
    }));

    res.json(body);
  },
);
