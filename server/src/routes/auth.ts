import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { prisma } from '../services/prisma';
import { requireAuth } from '../middleware/requireAuth';

export const authRouter = Router();

// ---------------------------------------------------------------------------
// find-or-create helper
// ---------------------------------------------------------------------------

/**
 * Resolves (or creates) the User record for an incoming OAuth callback.
 *
 * Priority order (login mode):
 *   1. Look up UserProvider by (provider, providerId) → return existing user.
 *   2. If email provided, look up User by email → create UserProvider row, return user.
 *   3. Create new User + UserProvider row.
 *
 * Link mode (req.session.oauthLinkMode === true):
 *   1. Require req.user (authenticated session).
 *   2. Bind the OAuth identity to req.user.id.
 *   3. Clear oauthLinkMode from session.
 */
export async function findOrCreateOAuthUser(
  req: Request,
  provider: string,
  providerId: string,
  email: string | undefined,
  displayName: string | undefined,
): Promise<any> {
  const session = req.session as any;

  // --- Step 1: look up by (provider, providerId) ---
  const existingProvider = await prisma.userProvider.findUnique({
    where: { provider_providerId: { provider, providerId } },
    include: { user: true },
  });

  if (existingProvider) {
    // Already linked — handle link-mode no-op
    if (session.oauthLinkMode) {
      const currentUser = req.user as any;
      if (!currentUser) {
        throw new Error('Link mode requires an authenticated session');
      }
      if (existingProvider.userId !== currentUser.id) {
        const err = new Error('OAuth identity already bound to a different account') as any;
        err.status = 409;
        throw err;
      }
      // Already linked to the same user — no-op
      delete session.oauthLinkMode;
    }
    return existingProvider.user;
  }

  // --- Link mode: bind to current session user ---
  if (session.oauthLinkMode) {
    const currentUser = req.user as any;
    if (!currentUser) {
      const err = new Error('Link mode requires an authenticated session') as any;
      err.status = 401;
      throw err;
    }
    await prisma.userProvider.create({
      data: { userId: currentUser.id, provider, providerId },
    });
    delete session.oauthLinkMode;
    // Return the full user from DB (req.user may be stale)
    const refreshed = await prisma.user.findUnique({ where: { id: currentUser.id } });
    return refreshed ?? currentUser;
  }

  // --- Step 2: email auto-link ---
  if (email) {
    const emailUser = await prisma.user.findUnique({ where: { email } });
    if (emailUser) {
      await prisma.userProvider.create({
        data: { userId: emailUser.id, provider, providerId },
      });
      return emailUser;
    }
  }

  // --- Step 3: create new user ---
  const newUser = await prisma.user.create({
    data: {
      email: email ?? `${provider}:${providerId}@oauth.local`,
      displayName: displayName ?? null,
      role: 'USER',
      provider,
      providerId,
      providers: {
        create: { provider, providerId },
      },
    },
  });
  return newUser;
}

// ---------------------------------------------------------------------------
// Conditional strategy registration
// ---------------------------------------------------------------------------

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(
    'github',
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: '/api/auth/github/callback',
        scope: ['read:user', 'user:email'],
        passReqToCallback: true,
      } as any,
      async (req: any, accessToken: string, _refreshToken: any, profile: any, done: any) => {
        (req.session as any).githubAccessToken = accessToken;
        try {
          const user = await findOrCreateOAuthUser(
            req,
            'github',
            String(profile.id),
            profile.emails?.[0]?.value,
            profile.displayName ?? profile.username,
          );
          done(null, user);
        } catch (err) {
          done(err);
        }
      },
    ),
  );
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    'google',
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: '/api/auth/google/callback',
        passReqToCallback: true,
      } as any,
      async (req: any, accessToken: string, _refreshToken: any, profile: any, done: any) => {
        (req.session as any).googleAccessToken = accessToken;
        try {
          const user = await findOrCreateOAuthUser(
            req,
            'google',
            String(profile.id),
            profile.emails?.[0]?.value,
            profile.displayName ?? profile.name?.givenName,
          );
          done(null, user);
        } catch (err) {
          done(err);
        }
      },
    ),
  );
}

// ---------------------------------------------------------------------------
// Demo login credentials
// ---------------------------------------------------------------------------
// These are intentionally hardcoded for template demonstration purposes.
const DEMO_CREDENTIALS = [
  { username: 'user',  password: 'pass',  email: 'user@demo.local',  displayName: 'Demo User',  role: 'USER'  as const },
  { username: 'admin', password: 'admin', email: 'admin@demo.local', displayName: 'Demo Admin', role: 'ADMIN' as const },
];

// POST /api/auth/demo-login
// Authenticates against hardcoded credential pairs; finds or creates the User record.
authRouter.post('/auth/demo-login', async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const match = DEMO_CREDENTIALS.find(
    (c) => c.username === username && c.password === password,
  );

  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  try {
    const user = await prisma.user.upsert({
      where: { email: match.email },
      update: { role: match.role },
      create: {
        email: match.email,
        displayName: match.displayName,
        role: match.role,
      },
    });

    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: 'Login failed' });
      res.json({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        },
      });
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// --- Test login (non-production only) ---
authRouter.post('/auth/test-login', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const { email, displayName, role, provider, providerId } = req.body;
    const resolvedEmail = email || 'test@example.com';
    const user = await prisma.user.upsert({
      where: { email: resolvedEmail },
      update: { displayName, role: role || 'USER' },
      create: {
        email: resolvedEmail,
        displayName: displayName || 'Test User',
        role: role || 'USER',
        provider: provider || 'test',
        providerId: providerId || `test-${resolvedEmail}`,
      },
    });
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: 'Login failed' });
      res.json(user);
    });
  } catch (err) {
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

  // Build the deduplicated linkedProviders list:
  // union of User.provider (primary) and all UserProvider rows.
  const providerRows = await prisma.userProvider.findMany({
    where: { userId: user.id },
    select: { provider: true },
  });
  const linked = new Set<string>(providerRows.map((r: { provider: string }) => r.provider));
  if (user.provider) linked.add(user.provider);

  res.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    avatarUrl: user.avatarUrl,
    provider: user.provider,
    providerId: user.providerId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    impersonating: !!realAdmin,
    realAdmin: realAdmin
      ? { id: realAdmin.id, displayName: realAdmin.displayName ?? null }
      : null,
    linkedProviders: [...linked],
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
// Unlink OAuth provider
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/unlink/:provider
 *
 * Removes the specified OAuth provider from the authenticated user's account.
 * Guardrail: if this is the user's only remaining login method, returns 400.
 *
 * Login method count: UserProvider rows + 1 if User.provider is non-null.
 * If User.provider is the same provider as a UserProvider row, they are
 * deduplicated (the row covers both).
 *
 * Returns 404 if the provider is not linked to this user.
 * Returns 400 if unlinking would leave zero login methods.
 * Returns 200 { success: true, linkedProviders: string[] } on success.
 */
authRouter.post('/auth/unlink/:provider', requireAuth, async (req: Request, res: Response) => {
  const user = req.user as any;
  const { provider } = req.params;

  // Load all UserProvider rows for this user
  const providerRows = await prisma.userProvider.findMany({
    where: { userId: user.id },
  });

  const isPrimary = user.provider === provider;
  const hasProviderRow = providerRows.some((r: any) => r.provider === provider);

  // 404 if not linked at all
  if (!hasProviderRow && !isPrimary) {
    return res.status(404).json({ error: 'Provider not linked to this account' });
  }

  // Count effective login methods (deduplicated):
  // If User.provider is the same as a UserProvider row, don't double-count.
  const primaryAlsoHasRow = isPrimary && hasProviderRow;
  const effectiveMethods = primaryAlsoHasRow
    ? providerRows.length               // primary is already counted in the rows
    : providerRows.length + (user.provider ? 1 : 0);

  // Guardrail: must leave at least one method
  if (effectiveMethods <= 1) {
    return res.status(400).json({
      error: 'Cannot unlink: this is your only remaining login method',
    });
  }

  // Delete the UserProvider row if it exists
  if (hasProviderRow) {
    await prisma.userProvider.deleteMany({
      where: { userId: user.id, provider },
    });
  }

  // Clear primary provider fields if this was the primary
  if (isPrimary) {
    await prisma.user.update({
      where: { id: user.id },
      data: { provider: null, providerId: null },
    });
  }

  // Return updated linkedProviders
  const remaining = await prisma.userProvider.findMany({
    where: { userId: user.id },
    select: { provider: true },
  });
  const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
  const updatedLinked = new Set<string>(remaining.map((r: { provider: string }) => r.provider));
  if (updatedUser?.provider) updatedLinked.add(updatedUser.provider);

  return res.json({ success: true, linkedProviders: [...updatedLinked] });
});

// ---------------------------------------------------------------------------
// GitHub OAuth routes
// ---------------------------------------------------------------------------

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
    (req.session as any).oauthLinkMode = true;
  }
  passport.authenticate('github')(req, res, next);
});

authRouter.get(
  '/auth/github/callback',
  (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate('github', { failureRedirect: '/login' })(req, res, next);
  },
  (req: Request, res: Response) => {
    // oauthLinkMode is cleared inside findOrCreateOAuthUser; check was done before auth
    res.redirect('/');
  },
);

// ---------------------------------------------------------------------------
// Google OAuth routes
// ---------------------------------------------------------------------------

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
    (req.session as any).oauthLinkMode = true;
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

authRouter.get(
  '/auth/google/callback',
  (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate('google', { failureRedirect: '/login' })(req, res, next);
  },
  (req: Request, res: Response) => {
    res.redirect('/');
  },
);
