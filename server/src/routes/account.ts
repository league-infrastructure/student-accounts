/**
 * Account routes — endpoints scoped to the signed-in student's own account.
 *
 * Every handler applies requireAuth + requireRole('student').
 * Requests from users with role=staff or role=admin return 403.
 *
 * Provisioning (workspace, Claude, LLM proxy) is admin-initiated only;
 * students cannot request services from this surface.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../services/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../errors.js';
import { adminBus } from '../services/change-bus.js';
import { accountEventsRouter } from './account-events.js';

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
    const { users, cohorts, logins, externalAccounts, llmProxyTokens } = req.services;

    // Fetch account data in parallel.
    const [user, userLogins, userAccounts, llmActive] = await Promise.all([
      users.findById(userId),
      logins.findAllByUser(userId),
      externalAccounts.findAllByUser(userId),
      llmProxyTokens.getActiveForUser(userId),
    ]);
    const llmProxyEnabled = llmActive != null;

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
        llmProxyEnabled,
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
      adminBus.notify('users');
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
      adminBus.notify('users');
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/account/llm-proxy — student self-service view of LLM proxy access
// ---------------------------------------------------------------------------
//
// Sprint 013 T006.
//
// Returns the student's current LLM-proxy status. Never returns plaintext.
// The endpoint URL is derived from the request so dev and prod surfaces
// match the origin the student actually signed in at.
accountRouter.get(
  '/account/llm-proxy',
  requireAuth,
  requireRole('student'),
  async (req: Request, res: Response) => {
    const userId: number = (req.session as any).userId;

    // Derive the endpoint URL from the request (not from config) so any
    // origin that serves the app also serves a working proxy URL.
    //
    // We return the base *without* /v1 because Anthropic's SDK (and
    // Claude Code by extension) always append `/v1/messages` to
    // ANTHROPIC_BASE_URL. Including /v1 here yielded /proxy/v1/v1/messages.
    const forwardedProto = req.header('x-forwarded-proto');
    const scheme = forwardedProto
      ? forwardedProto.split(',')[0].trim()
      : req.secure
        ? 'https'
        : 'http';
    const host = req.header('x-forwarded-host') ?? req.get('host') ?? 'localhost';
    const endpoint = `${scheme}://${host}/proxy`;

    const active = await req.services.llmProxyTokens.getActiveForUser(userId);
    if (!active) {
      return res.json({ enabled: false, endpoint });
    }

    return res.json({
      enabled: true,
      endpoint,
      token: (active as any).token_plaintext ?? null,
      tokensUsed: active.tokens_used,
      tokenLimit: active.token_limit,
      requestCount: active.request_count,
      expiresAt: active.expires_at,
      grantedAt: active.granted_at,
    });
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/account/credentials — self-service username / password update
// ---------------------------------------------------------------------------
//
// Sprint 020 T003 (SUC-020-001).
//
// Body: { username?, currentPassword, newPassword? }
// currentPassword is always required; at least one of username / newPassword
// must be present. Returns { id, username } on success. 401 on wrong
// currentPassword, 409 on username collision, 400 on invalid input.
accountRouter.patch(
  '/account/credentials',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId: number = (req.session as any).userId;
      const body = req.body as {
        username?: unknown;
        currentPassword?: unknown;
        newPassword?: unknown;
      };

      const currentPassword =
        typeof body.currentPassword === 'string' ? body.currentPassword : '';
      if (!currentPassword) {
        return res.status(400).json({ error: 'currentPassword is required' });
      }

      const patch: { username?: string; currentPassword: string; newPassword?: string } = {
        currentPassword,
      };
      if (body.username !== undefined) {
        patch.username = typeof body.username === 'string' ? body.username : '';
      }
      if (body.newPassword !== undefined) {
        patch.newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      }

      const { users } = req.services;
      const result = await users.updateCredentials(userId, patch);
      res.json(result);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return res.status(401).json({ error: (err as Error).message });
      }
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: (err as Error).message });
      }
      next(err);
    }
  },
);

accountRouter.use('/account', accountEventsRouter);
