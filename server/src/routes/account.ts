/**
 * Account routes — endpoints scoped to the signed-in user's own account.
 *
 * GET /account and DELETE /account/logins/:id apply requireAuth only and are
 * accessible to all authenticated roles (student, staff, admin). The response
 * shape is identical for all roles; fields that do not apply to non-students
 * (cohort, workspaceTempPassword, llmProxyEnabled) return null/false/empty
 * naturally when no corresponding DB records exist.
 *
 * GET /account/llm-proxy retains requireRole('student') — the LLM proxy
 * feature is student-only.
 *
 * Provisioning (workspace, Claude, LLM proxy) is admin-initiated only;
 * users cannot request services from this surface.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../services/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../errors.js';
import { adminBus } from '../services/change-bus.js';
import { accountEventsRouter } from './account-events.js';
import { LoginRepository } from '../services/repositories/login.repository.js';
import { classifyEmailOwnership } from '../services/auth/email-ownership.js';

export const accountRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/account — aggregate endpoint
// ---------------------------------------------------------------------------

/**
 * Returns the signed-in user's full account data in one response.
 * Accessible to all authenticated roles (student, staff, admin).
 *
 *   profile          — id, displayName, primaryEmail, cohort, role, createdAt,
 *                      workspaceTempPassword, llmProxyEnabled (null/false for non-students)
 *   logins           — all Login records for this user
 *   externalAccounts — all ExternalAccount records for this user
 */
accountRouter.get(
  '/account',
  requireAuth,
  async (req: Request, res: Response) => {
    const userId: number = (req.session as any).userId;
    const { users, cohorts, logins, externalAccounts, llmProxyTokens } = req.services;

    // Fetch account data in parallel.
    const [user, userLogins, userAccounts, llmActive, oauthClientCount] = await Promise.all([
      users.findById(userId),
      logins.findAllByUser(userId),
      externalAccounts.findAllByUser(userId),
      llmProxyTokens.getActiveForUser(userId),
      prisma.oAuthClient.count({ where: { created_by: userId, disabled_at: null } }),
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

    // Build the available-emails set: primary + each provider's email +
    // each workspace ExternalAccount's external_id. Dedupe case-insensitively
    // but preserve original casing in the output.
    const availableEmails = (() => {
      const seen = new Set<string>();
      const out: string[] = [];
      const add = (e?: string | null) => {
        if (!e) return;
        const norm = e.toLowerCase();
        if (seen.has(norm)) return;
        seen.add(norm);
        out.push(e);
      };
      add(user.primary_email);
      for (const l of userLogins) add(l.provider_email);
      for (const a of userAccounts) {
        if (a.type === 'workspace') add(a.external_id);
      }
      return out;
    })();
    const notificationEmail = (user as any).notification_email ?? null;

    // LLM proxy details (mirror of /api/account/llm-proxy fields). Returned
    // here so the Account page Features section can display token + endpoint
    // inline without an extra round-trip.
    const forwardedProto = req.header('x-forwarded-proto');
    const scheme = forwardedProto
      ? forwardedProto.split(',')[0].trim()
      : req.secure
        ? 'https'
        : 'http';
    const host = req.header('x-forwarded-host') ?? req.get('host') ?? 'localhost';
    const llmProxy = llmActive
      ? {
          token: (llmActive as any).token_plaintext ?? null,
          endpoint: `${scheme}://${host}/proxy`,
        }
      : null;

    const body = {
      profile: {
        id: user.id,
        displayName: user.display_name,
        primaryEmail: user.primary_email,
        notificationEmail,
        availableEmails,
        cohort,
        role: user.role,
        approvalStatus: (user as any).approval_status ?? 'approved',
        createdAt: user.created_at,
        workspaceTempPassword,
        llmProxyEnabled,
        oauthClientCount,
        llmProxy,
        username: (user as any).username ?? null,
        has_password: ((user as any).password_hash ?? null) !== null,
        allowsOauthClient: (user as any).allows_oauth_client ?? false,
        allowsLlmProxy: (user as any).allows_llm_proxy ?? false,
        allowsLeagueAccount: (user as any).allows_league_account ?? false,
        onboarding_completed: (user as any).onboarding_completed ?? true,
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
 * Removes a Login that belongs to the signed-in user.
 * Accessible to all authenticated roles (student, staff, admin).
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
      const body = (req.body ?? {}) as { displayName?: unknown; notificationEmail?: unknown };
      const update: { display_name?: string; notification_email?: string | null } = {};

      // displayName: optional. If present, validate; if absent, leave alone.
      if (body.displayName !== undefined) {
        const raw = body.displayName;
        const displayName = typeof raw === 'string' ? raw.trim() : '';
        if (displayName.length === 0 || displayName.length > 120) {
          return res
            .status(400)
            .json({ error: 'displayName must be a non-empty string under 120 characters' });
        }
        update.display_name = displayName;
      }

      // notificationEmail: optional. null clears it (use primary_email);
      // string is accepted when the address is either unused anywhere or
      // already owned by this user. An address owned by another user
      // is rejected.
      if (body.notificationEmail !== undefined) {
        const raw = body.notificationEmail;
        if (raw === null || raw === '') {
          update.notification_email = null;
        } else if (typeof raw === 'string') {
          const ownership = await classifyEmailOwnership(raw, userId);
          if (ownership === 'other') {
            return res
              .status(409)
              .json({ error: 'That email address is already in use by another account' });
          }
          update.notification_email = raw.trim().toLowerCase();
        } else {
          return res
            .status(400)
            .json({ error: 'notificationEmail must be a string or null' });
        }
      }

      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: 'No editable fields provided' });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: update,
      });
      adminBus.notify('users');
      res.json({
        ok: true,
        displayName: updated.display_name,
        notificationEmail: (updated as any).notification_email ?? null,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/account/complete-onboarding — one-time setup step for new users
// ---------------------------------------------------------------------------
//
// Called by the Onboarding page. Accepts { displayName, email? } in the body
// and writes them to the signed-in user's row along with
// onboarding_completed=true.
//
// email is optional. If provided it must be a non-empty string containing
// exactly one '@' with at least one '.' after it; it is normalised to
// lowercase before being stored in User.primary_email.
//
// No role gate — League-identity users skip this path entirely (their
// onboarding_completed is created as true), so in practice only newly
// created external-identity students hit this.
accountRouter.post(
  '/account/complete-onboarding',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId: number = (req.session as any).userId;
      const body = req.body as { displayName?: unknown; email?: unknown } | undefined;

      // --- displayName ---
      const raw = body?.displayName;
      const displayName = typeof raw === 'string' ? raw.trim() : '';
      if (displayName.length === 0 || displayName.length > 120) {
        return res
          .status(400)
          .json({ error: 'displayName must be a non-empty string under 120 characters' });
      }

      // --- email (optional) ---
      const rawEmail = body?.email;
      let normalizedEmail: string | undefined;
      if (rawEmail !== undefined && rawEmail !== null) {
        const emailStr = typeof rawEmail === 'string' ? rawEmail.trim() : '';
        if (emailStr.length === 0) {
          return res.status(400).json({ error: 'email must be a non-empty string when provided' });
        }
        // Basic shape check: must contain '@' and at least one '.' after it.
        const atIndex = emailStr.indexOf('@');
        if (atIndex < 1 || !emailStr.slice(atIndex + 1).includes('.')) {
          return res.status(400).json({ error: 'email must be a valid email address' });
        }
        normalizedEmail = emailStr.toLowerCase();
        // Reject emails owned by a different user. 'free' or 'mine' are OK.
        const ownership = await classifyEmailOwnership(normalizedEmail, userId);
        if (ownership === 'other') {
          return res
            .status(409)
            .json({ error: 'That email address is already in use by another account' });
        }
      }

      // --- persist ---
      await prisma.user.update({
        where: { id: userId },
        data: {
          display_name: displayName,
          onboarding_completed: true,
          ...(normalizedEmail !== undefined ? { primary_email: normalizedEmail } : {}),
        },
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
// Sprint 020 T003 (SUC-020-001); extended Sprint 028 T011.
//
// Body: { username?, currentPassword?, newPassword? }
//
// Normal path (user already has username or password_hash):
//   currentPassword is required. At least one of username / newPassword must
//   be present. Returns { id, username } on success. 401 on wrong
//   currentPassword, 409 on username collision, 400 on invalid input.
//
// First-time setup path (user has NEITHER username NOR password_hash):
//   currentPassword is NOT required. The handler detects this state from the
//   DB and sets allowFirstTimeSetup=true. On success a passphrase Login row is
//   created (provider='username', provider_user_id='self:<userId>:<username>')
//   if one does not already exist.
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

      // Determine whether this user is in first-time setup (no username AND
      // no password_hash). This check hits the DB once before we proceed.
      const dbUser = await (prisma as any).user.findUnique({ where: { id: userId } });
      if (!dbUser) {
        return res.status(401).json({ error: 'Session user not found' });
      }
      const isFirstTimeSetup =
        !dbUser.username && !dbUser.password_hash;

      // Require currentPassword on the normal path.
      const currentPassword =
        typeof body.currentPassword === 'string' ? body.currentPassword : '';
      if (!isFirstTimeSetup && !currentPassword) {
        return res.status(400).json({ error: 'currentPassword is required' });
      }

      const patch: {
        username?: string;
        currentPassword?: string;
        newPassword?: string;
        allowFirstTimeSetup?: boolean;
      } = {};

      if (currentPassword) {
        patch.currentPassword = currentPassword;
      }
      if (isFirstTimeSetup) {
        patch.allowFirstTimeSetup = true;
      }
      if (body.username !== undefined) {
        patch.username = typeof body.username === 'string' ? body.username : '';
      }
      if (body.newPassword !== undefined) {
        patch.newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      }

      const { users } = req.services;
      const result = await users.updateCredentials(userId, patch);

      // First-time setup: create a passphrase Login row if none exists.
      if (isFirstTimeSetup && result.username) {
        const providerUserId = `self:${userId}:${result.username}`;
        const existing = await LoginRepository.findByProvider(
          prisma,
          'username',
          providerUserId,
        );
        if (!existing) {
          await LoginRepository.create(prisma, {
            user_id: userId,
            provider: 'username',
            provider_user_id: providerUserId,
            provider_email: dbUser.primary_email ?? null,
            provider_username: result.username,
          });
        }
      }

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

// ---------------------------------------------------------------------------
// POST /api/account/test-email — send a one-off SMTP test to an owned address
// ---------------------------------------------------------------------------
//
// Sprint 028 T002.
//
// Body: { to?: string }
//   - If `to` is omitted, the user's notification_email (or primary_email) is used.
//   - If `to` is provided, it must be one of the user's owned addresses
//     (primary, any Login provider_email, or any workspace ExternalAccount external_id).
//
// Returns:
//   400 { error } when SMTP is not configured
//   400 { error } when `to` does not belong to the user
//   200 { ok: true, messageId, to } on success
//
// An audit event `account_test_email_sent` is written on success.
accountRouter.post(
  '/account/test-email',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId: number = (req.session as any).userId;
      const { mail, users, logins, externalAccounts, audit } = req.services;
      const rawTo = (req.body as { to?: unknown } | undefined)?.to;

      // Fetch the user record (needed for display name, notification email, primary email).
      const user = await users.findById(userId);

      // Resolve the target address.
      let resolved: string;
      if (rawTo === undefined || rawTo === null || rawTo === '') {
        // No explicit `to` — fall back to notification_email then primary_email.
        resolved = (user as any).notification_email ?? user.primary_email;
      } else if (typeof rawTo !== 'string') {
        return res.status(400).json({ error: '`to` must be a string email address or omitted' });
      } else {
        // Caller-supplied address: validate ownership.
        const [userLogins, userAccounts] = await Promise.all([
          logins.findAllByUser(userId),
          externalAccounts.findAllByUser(userId),
        ]);
        const owned = new Set<string>();
        const add = (e?: string | null) => {
          if (e) owned.add(e.toLowerCase());
        };
        add(user.primary_email);
        for (const l of userLogins) add(l.provider_email);
        for (const a of userAccounts) {
          if (a.type === 'workspace') add(a.external_id);
        }
        if (!owned.has(rawTo.toLowerCase())) {
          return res.status(400).json({ error: 'Address does not belong to this account' });
        }
        resolved = rawTo;
      }

      // Gate on SMTP configuration.
      if (!mail.isConfigured()) {
        return res
          .status(400)
          .json({ error: 'SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD in .env.' });
      }

      // Build message body.
      const displayName = (user as any).display_name ?? 'there';
      const timestamp = new Date().toISOString();
      const text =
        `Hi ${displayName},\n\n` +
        `This is a test email sent from the My Account page at ${timestamp}.\n\n` +
        `If you received this, your SMTP configuration is working correctly.`;

      // Send the email.
      const { messageId } = await mail.send({
        to: resolved,
        subject: 'League Accounts - test email',
        text,
      });

      // Write audit event.
      await audit.record(prisma, {
        action: 'account_test_email_sent',
        actor_user_id: userId,
        details: { to: resolved },
      });

      res.json({ ok: true, messageId, to: resolved });
    } catch (err) {
      next(err);
    }
  },
);

accountRouter.use('/account', accountEventsRouter);
