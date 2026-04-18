// NOTE: This auth route is a minimal shim for T003.
// OAuth flows (GitHub, Google), UserProvider logic, and the unlink endpoint
// are template features replaced by the domain Login model in a later sprint (T008).
// The test-login and auth/me endpoints are updated to use the domain User schema.

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../services/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const authRouter = Router();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
// Test login (non-production only)
// ---------------------------------------------------------------------------

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
authRouter.post('/auth/logout', (req: Request, res: Response, next: NextFunction) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((err) => {
      if (err) return next(err);
      res.json({ success: true });
    });
  });
});

// ---------------------------------------------------------------------------
// OAuth stubs — full implementation in a later sprint (T008 / OAuth sprint)
// ---------------------------------------------------------------------------

authRouter.post('/auth/unlink/:provider', requireAuth, (_req: Request, res: Response) => {
  res.status(501).json({ error: 'OAuth account linking not yet implemented' });
});

authRouter.get('/auth/github', (req: Request, res: Response) => {
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
  }
  return res.status(501).json({ error: 'GitHub OAuth not yet implemented' });
});

authRouter.get('/auth/github/callback', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'GitHub OAuth not yet implemented' });
});

authRouter.get('/auth/google', (req: Request, res: Response) => {
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
  }
  return res.status(501).json({ error: 'Google OAuth not yet implemented' });
});

authRouter.get('/auth/google/callback', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Google OAuth not yet implemented' });
});
