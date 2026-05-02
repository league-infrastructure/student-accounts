/**
 * Auth routes — OAuth strategy endpoints, shared auth utilities.
 *
 * Google OAuth (T002): GET /api/auth/google, GET /api/auth/google/callback
 * GitHub OAuth (T003): GET /api/auth/github, GET /api/auth/github/callback
 * Link mode  (T005): ?link=1 on initiation routes attaches a new provider to
 *                    the current authenticated user instead of creating a new
 *                    user. The verify callback in passport.config.ts detects
 *                    session.link and calls linkHandler; it returns a
 *                    { _linkResult } sentinel that the route callback reads.
 * Shared: /api/auth/me, POST /api/auth/logout, POST /api/auth/test-login
 */

import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { prisma } from '../services/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { StaffOULookupError } from '../services/google-workspace/google-workspace-admin.client.js';
import { PermanentlyDeniedError, signInHandler } from '../services/auth/sign-in.handler.js';
import { linkHandler } from '../services/auth/link.handler.js';
import { AuditService } from '../services/audit.service.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('auth.routes');

// Module-level AuditService instance for the logout route.
// Shared across requests; stateless and safe to reuse.
const auditService = new AuditService();

export const authRouter = Router();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the post-login landing page.
 * Sprint 016: all roles land on /account (universal dashboard).
 */
function postLoginRedirect(_role?: string): string {
  return '/account';
}

/** Map legacy USER/ADMIN role strings to domain enum values. */
function mapRole(role: string | undefined): string {
  if (role === 'ADMIN') return 'admin';
  if (role === 'USER') return 'student';
  if (role === 'admin' || role === 'staff' || role === 'student') return role as string;
  return 'student';
}

/** Serialize a domain User record to the shape callers/tests expect. */
function serializeUser(user: any) {
  return {
    id: user.id,
    email: user.primary_email,
    displayName: user.display_name,
    // Map domain role back to legacy strings so existing tests pass.
    role: user.role === 'admin' ? 'ADMIN' : user.role === 'staff' ? 'STAFF' : 'USER',
    avatarUrl: null,
    provider: null,
    providerId: null,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Test helpers (non-production only)
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/test-set-link
 * Sets session.link = true and session.linkReturnTo = '/account' for testing
 * link-mode OAuth flows. Only available outside production.
 */
authRouter.post('/auth/test-set-link', (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  (req.session as any).link = true;
  (req.session as any).linkReturnTo = '/account';
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Failed to save session' });
    res.json({ link: true, linkReturnTo: '/account' });
  });
});

authRouter.post('/auth/test-login', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const { email, displayName, role } = req.body;
    const resolvedEmail = email || 'test@example.com';
    const user = await prisma.user.upsert({
      where: { primary_email: resolvedEmail },
      update: {
        display_name: displayName || resolvedEmail,
        role: mapRole(role),
      },
      create: {
        primary_email: resolvedEmail,
        display_name: displayName || resolvedEmail,
        role: mapRole(role),
        created_via: 'admin_created',
      },
    });
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: 'Login failed' });
      // Set session fields used by requireAuth and requireRole middleware.
      (req.session as any).userId = user.id;
      (req.session as any).role = user.role;
      res.json(serializeUser(user));
    });
  } catch (_err) {
    res.status(500).json({ error: 'Test login failed' });
  }
});

// ---------------------------------------------------------------------------
// Shared auth endpoints
// ---------------------------------------------------------------------------

// Get current user
authRouter.get('/auth/me', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = req.user as any;
  const realAdmin = (req as any).realAdmin as any | undefined;

  // Re-fetch from DB to get fresh data. If the user was deleted or
  // soft-deactivated while the session was alive, blow the session
  // away so the client redirects to the login flow instead of holding
  // onto a phantom identity.
  const fresh = await prisma.user.findUnique({ where: { id: user.id } });
  if (!fresh || fresh.is_active === false) {
    req.session.destroy(() => {
      res.status(401).json({ error: 'Not authenticated' });
    });
    return;
  }
  const effectiveUser = fresh;

  res.json({
    id: effectiveUser.id,
    email: effectiveUser.primary_email,
    displayName: effectiveUser.display_name,
    role: effectiveUser.role === 'admin' ? 'ADMIN' : effectiveUser.role === 'staff' ? 'STAFF' : 'USER',
    approvalStatus: effectiveUser.approval_status ?? 'approved',
    onboardingCompleted: effectiveUser.onboarding_completed ?? true,
    avatarUrl: null,
    provider: null,
    providerId: null,
    createdAt: effectiveUser.created_at,
    updatedAt: effectiveUser.updated_at,
    impersonating: !!realAdmin,
    realAdmin: realAdmin
      ? { id: realAdmin.id, displayName: realAdmin.display_name ?? realAdmin.displayName ?? null }
      : null,
    linkedProviders: [],
  });
});

// Logout
authRouter.post('/auth/logout', (req: Request, res: Response, _next: NextFunction) => {
  // Capture userId BEFORE destroying the session so we can write the audit event.
  const userId: number | undefined = (req.session as any).userId ?? (req.user as any)?.id;

  // Best-effort audit write: fire-and-forget after session destruction.
  // Does not block logout regardless of success or failure.
  const writeLogoutAudit = (resolvedUserId: number | undefined): void => {
    if (!resolvedUserId) return;
    auditService
      .record(prisma, {
        actor_user_id: resolvedUserId,
        action: 'auth_logout',
        target_user_id: resolvedUserId,
        target_entity_type: 'User',
        target_entity_id: String(resolvedUserId),
      })
      .catch((err) => {
        // Best-effort: log but do not surface to the client.
        console.error('[auth] Failed to write auth_logout audit event', err);
      });
  };

  req.logout((logoutErr) => {
    if (logoutErr) {
      // Even if passport.logout fails, attempt session destruction.
      console.error('[auth] passport.logout error', logoutErr);
    }

    // If no session exists, respond 200 immediately (idempotent logout).
    if (!req.session) {
      writeLogoutAudit(userId);
      res.clearCookie('connect.sid');
      return res.json({ success: true });
    }

    req.session.destroy((destroyErr) => {
      if (destroyErr) {
        // Session destruction failed — still return success to the client
        // (the passport.logout above already cleared the passport user).
        console.error('[auth] session.destroy error', destroyErr);
      }
      writeLogoutAudit(userId);
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });
});

// ---------------------------------------------------------------------------
// Google OAuth routes (T002, T005)
// ---------------------------------------------------------------------------

/**
 * GET /api/auth/google
 * Initiates the Google OAuth redirect.
 * Returns 501 if GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are absent.
 * Returns 401 if ?link=1 is passed and the user is not authenticated
 * (account-linking mode requires an existing session).
 * Sets session.link and session.linkReturnTo when ?link=1 and user is signed in.
 */
authRouter.get('/auth/google', (req: Request, res: Response, next: NextFunction) => {
  logger.info({ linkMode: req.query.link === '1' }, '[google] initiation route called');
  if (!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) {
    logger.error({}, '[google] Google credentials not configured');
    return res.status(501).json({
      error: 'Google OAuth not configured',
      docs: 'https://console.cloud.google.com/apis/credentials',
    });
  }
  if (req.query.link === '1') {
    logger.info({ authenticated: !!req.user }, '[google] link mode requested');
    if (!req.user) {
      logger.warn({}, '[google] link mode requested but not authenticated');
      return res.status(401).json({ error: 'Authentication required to link an account' });
    }
    // Mark the session so the verify callback (via passReqToCallback) can
    // detect link mode and call linkHandler instead of signInHandler.
    (req.session as any).link = true;
    (req.session as any).linkReturnTo = '/account';
    logger.info({}, '[google] link mode flagged in session');
  }
  logger.info({}, '[google] redirecting to Google OAuth');
  passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })(req, res, next);
});

/**
 * GET /api/auth/google/callback
 * Google redirects here after the user grants (or denies) consent.
 *
 * Normal mode: writes userId + role to session, redirects to /account.
 * Link mode: verify callback ran linkHandler and returned { _linkResult }.
 *   - 'linked'         → clear flags, redirect to /account
 *   - 'already_linked' → clear flags, redirect to /account (idempotent)
 *   - 'conflict'       → clear flags, redirect to /account?error=already_linked
 * Failure/denial: redirects to /?error=oauth_denied.
 */
authRouter.get(
  '/auth/google/callback',
  (req: Request, res: Response, next: NextFunction) => {
    logger.info({}, '[google-callback] route handler called');
    if (!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) {
      logger.error({}, '[google-callback] Google credentials not configured, rejecting');
      return res.redirect('/?error=oauth_denied');
    }
    // Use a custom callback to intercept authentication failures and redirect
    // instead of letting Passport return a default 401.
    logger.info({}, '[google-callback] calling passport.authenticate');
    passport.authenticate(
      'google',
      { session: false },
      (err: unknown, user: Express.User | false | null, info: unknown) => {
        logger.info(
          { hasErr: !!err, hasUser: !!user, info },
          '[google-callback] passport.authenticate callback fired'
        );
        if (err) {
          logger.error({ err }, '[google-callback] authentication error');
          if (err instanceof StaffOULookupError) {
            logger.error(
              { code: err.code, email: err.email },
              '[google-callback] StaffOULookupError, redirecting'
            );
            return res.redirect('/?error=staff_lookup_failed');
          }
          if (err instanceof PermanentlyDeniedError) {
            logger.warn(
              { userId: err.userId },
              '[google-callback] PermanentlyDeniedError, redirecting'
            );
            return res.redirect('/login?error=permanently_denied');
          }
          logger.error({}, '[google-callback] generic error, redirecting');
          return res.redirect('/?error=oauth_denied');
        }
        if (!user) {
          logger.error({ info }, '[google-callback] no user returned by passport');
          return res.redirect('/?error=oauth_denied');
        }

        logger.info(
          { userId: (user as any).id, email: (user as any).email },
          '[google-callback] user object received from passport'
        );

        // Link mode: the verify callback in passport.config.ts detected
        // session.link and ran linkHandler, encoding the result as a sentinel
        // object { _linkResult: 'linked' | 'already_linked' | 'conflict' }.
        const linkResult = (user as any)._linkResult;
        if (linkResult) {
          logger.info(
            { linkResult },
            '[google-callback] link mode detected'
          );
          // Clear link-mode flags regardless of outcome.
          delete (req.session as any).link;
          delete (req.session as any).linkReturnTo;

          if (linkResult === 'conflict') {
            logger.info({}, '[google-callback] link conflict, redirecting with error');
            return res.redirect('/account?error=already_linked');
          }
          // 'linked' or 'already_linked' → success / idempotent.
          logger.info({}, '[google-callback] link succeeded, redirecting to /account');
          return res.redirect('/account');
        }

        // Pending-approval users may sign in; the /account page shows
        // a "Waiting for approval" card and the sidebar locks down to
        // just the Account link until an admin flips approval_status.
        // Permanently-denied users were rejected earlier (sign-in handler
        // throws PermanentlyDeniedError before we reach this point).
        logger.info(
          { userId: (user as any).id, role: (user as any).role },
          '[google-callback] normal sign-in, calling req.login'
        );
        req.login(user, (loginErr) => {
          if (loginErr) {
            logger.error({ loginErr }, '[google-callback] req.login failed');
            return next(loginErr);
          }
          logger.info(
            { userId: (user as any).id },
            '[google-callback] req.login succeeded, setting session'
          );
          (req.session as any).userId = (user as any).id;
          (req.session as any).role = (user as any).role;
          logger.info(
            { userId: (user as any).id, role: (user as any).role, sessionId: req.sessionID },
            '[google-callback] session fields set, calling session.save'
          );
          req.session.save((saveErr) => {
            if (saveErr) {
              logger.error(
                { saveErr, sessionId: req.sessionID },
                '[google-callback] session.save failed'
              );
              return res.redirect('/?error=oauth_denied');
            }
            const dest = postLoginRedirect((user as any).role);
            logger.info(
              { userId: (user as any).id, sessionId: req.sessionID, dest },
              '[google-callback] session saved successfully, redirecting'
            );
            res.redirect(dest);
          });
        });
      },
    )(req, res, next);
  },
);

// ---------------------------------------------------------------------------
// GitHub OAuth routes (T003, T005)
// ---------------------------------------------------------------------------

/**
 * GET /api/auth/github
 * Initiates the GitHub OAuth redirect.
 * Returns 501 if GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are absent.
 * Returns 401 if ?link=1 is passed and the user is not authenticated.
 * Sets session.link and session.linkReturnTo when ?link=1 and user is signed in.
 */
authRouter.get('/auth/github', (req: Request, res: Response, next: NextFunction) => {
  logger.info({ linkMode: req.query.link === '1' }, '[github] initiation route called');
  if (!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)) {
    logger.error({}, '[github] GitHub credentials not configured');
    return res.status(501).json({
      error: 'GitHub OAuth not configured',
      docs: 'https://github.com/settings/developers',
    });
  }
  if (req.query.link === '1') {
    logger.info({ authenticated: !!req.user }, '[github] link mode requested');
    if (!req.user) {
      logger.warn({}, '[github] link mode requested but not authenticated');
      return res.status(401).json({ error: 'Authentication required to link an account' });
    }
    // Mark the session so the verify callback can detect link mode.
    (req.session as any).link = true;
    (req.session as any).linkReturnTo = '/account';
    logger.info({}, '[github] link mode flagged in session');
  }
  logger.info({}, '[github] redirecting to GitHub OAuth');
  passport.authenticate('github', { scope: ['read:user', 'user:email'] })(req, res, next);
});

/**
 * GET /api/auth/github/callback
 * GitHub redirects here after the user grants (or denies) consent.
 *
 * Normal mode: writes userId + role to session, redirects to /account.
 * Link mode: verify callback ran linkHandler and returned { _linkResult }.
 * Failure/denial: redirects to /?error=oauth_denied.
 */
authRouter.get(
  '/auth/github/callback',
  (req: Request, res: Response, next: NextFunction) => {
    logger.info({}, '[github-callback] route handler called');
    if (!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)) {
      logger.error({}, '[github-callback] GitHub credentials not configured, rejecting');
      return res.redirect('/?error=oauth_denied');
    }
    logger.info({}, '[github-callback] calling passport.authenticate');
    passport.authenticate(
      'github',
      { session: false },
      (err: unknown, user: Express.User | false | null) => {
        logger.info(
          { hasErr: !!err, hasUser: !!user },
          '[github-callback] passport.authenticate callback fired'
        );
        if (err) {
          logger.error({ err }, '[github-callback] authentication error');
          if (err instanceof PermanentlyDeniedError) {
            logger.warn(
              { userId: err.userId },
              '[github-callback] PermanentlyDeniedError, redirecting'
            );
            return res.redirect('/login?error=permanently_denied');
          }
          return res.redirect('/?error=oauth_denied');
        }
        if (!user) {
          logger.error({}, '[github-callback] no user returned by passport');
          return res.redirect('/?error=oauth_denied');
        }

        logger.info(
          { userId: (user as any).id, email: (user as any).email },
          '[github-callback] user object received from passport'
        );

        // Link mode: verify callback returned a _linkResult sentinel.
        const linkResult = (user as any)._linkResult;
        if (linkResult) {
          logger.info(
            { linkResult },
            '[github-callback] link mode detected'
          );
          // Clear link-mode flags regardless of outcome.
          delete (req.session as any).link;
          delete (req.session as any).linkReturnTo;

          if (linkResult === 'conflict') {
            logger.info({}, '[github-callback] link conflict, redirecting with error');
            return res.redirect('/account?error=already_linked');
          }
          // 'linked' or 'already_linked' → success / idempotent.
          logger.info({}, '[github-callback] link succeeded, redirecting to /account');
          return res.redirect('/account');
        }

        // Pending-approval users may sign in; same rule as Google.
        logger.info(
          { userId: (user as any).id, role: (user as any).role },
          '[github-callback] normal sign-in, calling req.login'
        );
        req.login(user, (loginErr) => {
          if (loginErr) {
            logger.error({ loginErr }, '[github-callback] req.login failed');
            return next(loginErr);
          }
          logger.info(
            { userId: (user as any).id },
            '[github-callback] req.login succeeded, setting session'
          );
          (req.session as any).userId = (user as any).id;
          (req.session as any).role = (user as any).role;
          logger.info(
            { userId: (user as any).id, role: (user as any).role, sessionId: req.sessionID },
            '[github-callback] session fields set, calling session.save'
          );
          req.session.save((saveErr) => {
            if (saveErr) {
              logger.error(
                { saveErr, sessionId: req.sessionID },
                '[github-callback] session.save failed'
              );
              return res.redirect('/?error=oauth_denied');
            }
            const dest = postLoginRedirect((user as any).role);
            logger.info(
              { userId: (user as any).id, sessionId: req.sessionID, dest },
              '[github-callback] session saved successfully, redirecting'
            );
            res.redirect(dest);
          });
        });
      },
    )(req, res, next);
  },
);

// ---------------------------------------------------------------------------
// Pike 13 OAuth 2.0 (manual flow — no Passport strategy)
//
// Pike 13 uses a standard authorization-code flow but doesn't have a
// maintained Passport strategy, so the route handles the redirect, token
// exchange, and profile fetch itself, then delegates to the same
// signInHandler used by Google + GitHub.
//
// Endpoints:
//   GET /api/auth/pike13           → redirect to Pike13 authorize endpoint
//   GET /api/auth/pike13/callback  → exchange code, sign in, establish session
//
// Approval-gate, PermanentlyDeniedError, and link-mode behavior all mirror
// the Google callback.
// ---------------------------------------------------------------------------

const PIKE13_AUTH_DOCS = 'https://developer.pike13.com/docs/authentication';

function pike13AuthBase(): string {
  const apiBase = process.env.PIKE13_API_BASE;
  if (apiBase) return apiBase.replace('/api/v2/desk', '');
  return 'https://pike13.com';
}

function pike13CallbackUrl(): string {
  return (
    process.env.PIKE13_CALLBACK_URL ||
    'http://localhost:5173/api/auth/pike13/callback'
  );
}

function pike13Configured(): boolean {
  return !!(process.env.PIKE13_CLIENT_ID && process.env.PIKE13_CLIENT_SECRET);
}

async function pike13ExchangeCodeForToken(code: string): Promise<string> {
  const response = await fetch(`${pike13AuthBase()}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pike13CallbackUrl(),
      client_id: process.env.PIKE13_CLIENT_ID!,
      client_secret: process.env.PIKE13_CLIENT_SECRET!,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Pike 13 token exchange failed: ${response.status} ${detail}`);
  }
  const data: any = await response.json();
  if (!data.access_token) {
    throw new Error('Pike 13 token response missing access_token');
  }
  return data.access_token;
}

async function pike13FetchProfile(
  accessToken: string,
): Promise<{ id: string; email: string; name: string }> {
  const authBase = pike13AuthBase();
  let r = await fetch(`${authBase}/api/v2/front/people/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!r.ok) {
    r = await fetch(`${authBase}/api/v2/me`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
  }
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Pike 13 profile fetch failed: ${r.status} ${body}`);
  }
  const data: any = await r.json();
  const person = data?.person ?? data?.people?.[0];
  if (!person) {
    throw new Error('Pike 13 profile response missing person data');
  }
  const id = String(person.id ?? '');
  const email = (person.email ?? '').toLowerCase();
  const name =
    person.name ||
    [person.first_name, person.last_name].filter(Boolean).join(' ') ||
    email;
  if (!id || !email) {
    throw new Error(`Pike 13 profile missing required fields — id=${id} email=${email}`);
  }
  return { id, email, name };
}

authRouter.get('/auth/pike13', (req: Request, res: Response) => {
  logger.info({}, '[pike13] route handler called');
  if (!pike13Configured()) {
    return res.status(501).json({
      error: 'Pike 13 OAuth not configured',
      detail: 'Set PIKE13_CLIENT_ID and PIKE13_CLIENT_SECRET',
      docs: PIKE13_AUTH_DOCS,
    });
  }
  // Link mode: ?link=1 binds the new identity to the current user.
  if (req.query.link === '1') {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required to link an account' });
    }
    (req.session as any).link = true;
  }
  const params = new URLSearchParams({
    client_id: process.env.PIKE13_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: pike13CallbackUrl(),
  });
  res.redirect(`${pike13AuthBase()}/oauth/authorize?${params}`);
});

authRouter.get(
  '/auth/pike13/callback',
  async (req: Request, res: Response, next: NextFunction) => {
    logger.info({}, '[pike13-callback] route handler called');
    if (!pike13Configured()) {
      return res.redirect('/?error=oauth_denied');
    }

    const code = req.query.code;
    if (!code || typeof code !== 'string') {
      logger.warn({}, '[pike13-callback] missing or invalid code, redirecting');
      return res.redirect('/?error=oauth_denied');
    }

    const session = req.session as any;
    const isLinkMode = !!(session.link && session.userId);
    const linkUserId: number | undefined = session.userId;

    try {
      const token = await pike13ExchangeCodeForToken(code);
      session.pike13AccessToken = token;
      const profile = await pike13FetchProfile(token);

      const { users, logins } = req.services;

      // Link mode: attach the Pike13 identity to the currently signed-in user.
      if (isLinkMode && linkUserId) {
        const result = await linkHandler(
          'pike13',
          {
            providerUserId: profile.id,
            providerEmail: profile.email,
            displayName: profile.name,
            providerUsername: null,
          },
          linkUserId,
          logins,
        );
        delete session.link;
        delete session.linkReturnTo;
        if (result.action === 'conflict') {
          return res.redirect('/account?error=already_linked');
        }
        return res.redirect('/account');
      }

      // Normal sign-in path.
      const user = await signInHandler(
        'pike13',
        {
          providerUserId: profile.id,
          providerEmail: profile.email,
          displayName: profile.name,
          providerUsername: null,
          rawProfile: profile,
        },
        users,
        logins,
        {
          requestContext: {
            ip: req.ip,
            userAgent: req.headers['user-agent'],
          },
        },
      );

      // Pending-approval users may sign in; same rule as Google/GitHub.
      req.login(user, (loginErr) => {
        if (loginErr) {
          logger.error({ loginErr }, '[pike13-callback] req.login failed');
          return next(loginErr);
        }
        (req.session as any).userId = (user as any).id;
        (req.session as any).role = (user as any).role;
        req.session.save((saveErr) => {
          if (saveErr) {
            logger.error({ saveErr }, '[pike13-callback] session.save failed');
            return res.redirect('/?error=oauth_denied');
          }
          res.redirect(postLoginRedirect((user as any).role));
        });
      });
    } catch (err) {
      if (err instanceof PermanentlyDeniedError) {
        logger.warn(
          { userId: err.userId },
          '[pike13-callback] PermanentlyDeniedError, redirecting'
        );
        return res.redirect('/login?error=permanently_denied');
      }
      logger.error({ err }, '[pike13-callback] unexpected error');
      res.redirect('/?error=oauth_denied');
    }
  },
);

// ---------------------------------------------------------------------------
// Account-linking stub (future sprint)
// ---------------------------------------------------------------------------

authRouter.post('/auth/unlink/:provider', requireAuth, (_req: Request, res: Response) => {
  res.status(501).json({ error: 'OAuth account linking not yet implemented' });
});
