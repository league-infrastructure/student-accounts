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
import { AuditService } from '../services/audit.service.js';

// Module-level AuditService instance for the logout route.
// Shared across requests; stateless and safe to reuse.
const auditService = new AuditService();

export const authRouter = Router();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the appropriate post-login landing page for a given domain role.
 * Domain roles: 'admin', 'staff', 'student'.
 */
function postLoginRedirect(role: string | undefined): string {
  if (role === 'admin') return '/';
  if (role === 'staff') return '/staff/directory';
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

  // Re-fetch from DB to get fresh data
  const fresh = await prisma.user.findUnique({ where: { id: user.id } });
  const effectiveUser = fresh ?? user;

  res.json({
    id: effectiveUser.id,
    email: effectiveUser.primary_email,
    displayName: effectiveUser.display_name,
    role: effectiveUser.role === 'admin' ? 'ADMIN' : effectiveUser.role === 'staff' ? 'STAFF' : 'USER',
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
  if (!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) {
    return res.status(501).json({
      error: 'Google OAuth not configured',
      docs: 'https://console.cloud.google.com/apis/credentials',
    });
  }
  if (req.query.link === '1') {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required to link an account' });
    }
    // Mark the session so the verify callback (via passReqToCallback) can
    // detect link mode and call linkHandler instead of signInHandler.
    (req.session as any).link = true;
    (req.session as any).linkReturnTo = '/account';
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
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
    if (!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) {
      return res.redirect('/?error=oauth_denied');
    }
    // Use a custom callback to intercept authentication failures and redirect
    // instead of letting Passport return a default 401.
    passport.authenticate(
      'google',
      { session: false },
      (err: unknown, user: Express.User | false | null, info: unknown) => {
        console.log('[google-callback] err=', err, 'user=', !!user, 'info=', info);
        if (err) {
          console.error('[google-callback] error:', err);
          if (err instanceof StaffOULookupError) {
            return res.redirect('/?error=staff_lookup_failed');
          }
          return res.redirect('/?error=oauth_denied');
        }
        if (!user) {
          console.error('[google-callback] no user returned by passport. info=', info);
          return res.redirect('/?error=oauth_denied');
        }

        // Link mode: the verify callback in passport.config.ts detected
        // session.link and ran linkHandler, encoding the result as a sentinel
        // object { _linkResult: 'linked' | 'already_linked' | 'conflict' }.
        const linkResult = (user as any)._linkResult;
        if (linkResult) {
          // Clear link-mode flags regardless of outcome.
          delete (req.session as any).link;
          delete (req.session as any).linkReturnTo;

          if (linkResult === 'conflict') {
            return res.redirect('/account?error=already_linked');
          }
          // 'linked' or 'already_linked' → success / idempotent.
          return res.redirect('/account');
        }

        // Normal sign-in path.
        req.login(user, (loginErr) => {
          if (loginErr) {
            console.error('[oauth-callback] req.login error:', loginErr);
            return next(loginErr);
          }
          (req.session as any).userId = (user as any).id;
          (req.session as any).role = (user as any).role;
          console.log('[oauth-callback] session set userId=', (user as any).id, 'role=', (user as any).role);
          req.session.save((saveErr) => {
            if (saveErr) {
              console.error('[oauth-callback] session.save error:', saveErr);
              return res.redirect('/?error=oauth_denied');
            }
            const dest = postLoginRedirect((user as any).role);
            console.log('[oauth-callback] session saved, redirecting to', dest);
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
  if (!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)) {
    return res.status(501).json({
      error: 'GitHub OAuth not configured',
      docs: 'https://github.com/settings/developers',
    });
  }
  if (req.query.link === '1') {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required to link an account' });
    }
    // Mark the session so the verify callback can detect link mode.
    (req.session as any).link = true;
    (req.session as any).linkReturnTo = '/account';
  }
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
    if (!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)) {
      return res.redirect('/?error=oauth_denied');
    }
    passport.authenticate(
      'github',
      { session: false },
      (err: unknown, user: Express.User | false | null) => {
        if (err || !user) {
          return res.redirect('/?error=oauth_denied');
        }

        // Link mode: verify callback returned a _linkResult sentinel.
        const linkResult = (user as any)._linkResult;
        if (linkResult) {
          // Clear link-mode flags regardless of outcome.
          delete (req.session as any).link;
          delete (req.session as any).linkReturnTo;

          if (linkResult === 'conflict') {
            return res.redirect('/account?error=already_linked');
          }
          // 'linked' or 'already_linked' → success / idempotent.
          return res.redirect('/account');
        }

        // Normal sign-in path.
        req.login(user, (loginErr) => {
          if (loginErr) {
            console.error('[oauth-callback] req.login error:', loginErr);
            return next(loginErr);
          }
          (req.session as any).userId = (user as any).id;
          (req.session as any).role = (user as any).role;
          console.log('[oauth-callback] session set userId=', (user as any).id, 'role=', (user as any).role);
          req.session.save((saveErr) => {
            if (saveErr) {
              console.error('[oauth-callback] session.save error:', saveErr);
              return res.redirect('/?error=oauth_denied');
            }
            const dest = postLoginRedirect((user as any).role);
            console.log('[oauth-callback] session saved, redirecting to', dest);
            res.redirect(dest);
          });
        });
      },
    )(req, res, next);
  },
);

// ---------------------------------------------------------------------------
// Account-linking stub (future sprint)
// ---------------------------------------------------------------------------

authRouter.post('/auth/unlink/:provider', requireAuth, (_req: Request, res: Response) => {
  res.status(501).json({ error: 'OAuth account linking not yet implemented' });
});
