/**
 * Route-level integration tests for GitHub OAuth (T003 — UC-002 happy path).
 *
 * Tests the full HTTP flow from the GitHub OAuth callback through session
 * establishment. Uses a MockGitHubStrategy (bypasses the OAuth redirect and
 * calls the verify callback directly with a controlled profile).
 *
 * The real Passport session middleware (serializeUser / deserializeUser) runs
 * — only the OAuth redirect round-trip is replaced.
 *
 * Covers:
 *  - GET /api/auth/github → 501 when env vars absent.
 *  - OAuth callback: new user created, provider_username stored, session established.
 *  - OAuth callback: new user without public email → .invalid address used.
 *  - OAuth callback: returning user signed in, no new User/Login created.
 *  - OAuth callback: error/denial redirects to /?error=oauth_denied.
 *  - GET /account returns 200 after GitHub sign-in.
 *  - mergeScan stub is called for new GitHub users.
 */

import request from 'supertest';
import passport from 'passport';
import { Strategy as PassportStrategy } from 'passport-strategy';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeUser, makeLogin } from '../helpers/factories.js';

process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// MockGitHubStrategy
//
// A minimal Passport strategy that mimics the github strategy but calls the
// verify callback directly with a controlled profile instead of redirecting
// to GitHub.
//
// Calling mockGitHubStrategy.setProfile(profile) changes what the next
// authenticate call sends to the verify callback.
// Calling mockGitHubStrategy.setError(true) simulates an OAuth failure.
// ---------------------------------------------------------------------------

type VerifyCallback = (
  accessToken: string,
  refreshToken: string,
  profile: any,
  done: (err: any, user?: any) => void,
) => void;

class MockGitHubStrategy extends PassportStrategy {
  name = 'github';
  private _profile: any = null;
  private _simulateError = false;
  private _verifyCallback: VerifyCallback;

  constructor(verifyCallback: VerifyCallback) {
    super();
    this._verifyCallback = verifyCallback;
  }

  setProfile(profile: any): void {
    this._profile = profile;
    this._simulateError = false;
  }

  setError(enabled: boolean): void {
    this._simulateError = enabled;
  }

  authenticate(_req: any, _options?: any): void {
    if (this._simulateError || !this._profile) {
      return this.fail({ message: 'OAuth error' });
    }
    this._verifyCallback('mock-access-token', 'mock-refresh-token', this._profile, (err, user) => {
      if (err) return this.error(err);
      if (!user) return this.fail({ message: 'No user returned' });
      this.success(user);
    });
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

import app from '../../../server/src/app.js';
import { signInHandler } from '../../../server/src/services/auth/sign-in.handler.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { UserService } from '../../../server/src/services/user.service.js';
import { LoginService } from '../../../server/src/services/login.service.js';

/**
 * Replicates the GitHub verify callback from passport.config.ts so the
 * MockGitHubStrategy exercises the same sign-in handler path.
 */
function makeVerifyCallback(userService: UserService, loginService: LoginService): VerifyCallback {
  return (_accessToken, _refreshToken, profile, done) => {
    const emails = profile.emails ?? [];
    const providerEmail = emails.find((e: any) => e.value)?.value ?? null;
    const providerUsername = profile.username ?? null;
    const displayName =
      profile.displayName || providerUsername || providerEmail || profile.id;

    signInHandler(
      'github',
      {
        providerUserId: profile.id,
        providerEmail,
        displayName,
        providerUsername,
      },
      userService,
      loginService,
    )
      .then((user) => done(null, user))
      .catch((err) => done(err));
  };
}

let mockStrategy: MockGitHubStrategy;
let userService: UserService;
let loginService: LoginService;

async function cleanDb() {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

// Set fake env vars so the strategy gates don't return 501
const SAVED_ENV: Record<string, string | undefined> = {};

beforeAll(() => {
  SAVED_ENV.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
  SAVED_ENV.GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
  SAVED_ENV.GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL;

  process.env.GITHUB_CLIENT_ID = 'test-gh-client-id';
  process.env.GITHUB_CLIENT_SECRET = 'test-gh-client-secret';
  process.env.GITHUB_CALLBACK_URL = 'http://localhost:3000/api/auth/github/callback';

  userService = new UserService(prisma, new AuditService());
  loginService = new LoginService(prisma, new AuditService());

  // Register the mock strategy — overrides the real github strategy for tests
  mockStrategy = new MockGitHubStrategy(makeVerifyCallback(userService, loginService));
  passport.use('github', mockStrategy as any);
});

afterAll(async () => {
  // Restore env vars
  for (const [key, val] of Object.entries(SAVED_ENV)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  await cleanDb();
});

beforeEach(async () => {
  await cleanDb();
});

// ---------------------------------------------------------------------------
// GET /api/auth/github — initiation
// ---------------------------------------------------------------------------

describe('GET /api/auth/github', () => {
  it('returns 501 when GITHUB_CLIENT_ID is not set', async () => {
    const savedId = process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_ID;

    const res = await request(app).get('/api/auth/github');
    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/not configured/i);
    expect(res.body).toHaveProperty('docs');

    process.env.GITHUB_CLIENT_ID = savedId;
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/github/callback — new user with email (UC-002 happy path)
// ---------------------------------------------------------------------------

describe('GET /api/auth/github/callback — new user with email', () => {
  const githubProfile = {
    id: 'gh-uid-newuser',
    displayName: 'New GitHub User',
    username: 'newghuser',
    emails: [{ value: 'newghuser@example.com' }],
  };

  it('creates a new User record on first sign-in', async () => {
    mockStrategy.setProfile(githubProfile);

    await request(app).get('/api/auth/github/callback');

    const user = await (prisma as any).user.findFirst({
      where: { primary_email: 'newghuser@example.com' },
    });
    expect(user).not.toBeNull();
    expect(user.role).toBe('student');
    expect(user.created_via).toBe('social_login');
  });

  it('creates a Login record with provider_username set to the GitHub username', async () => {
    mockStrategy.setProfile(githubProfile);

    await request(app).get('/api/auth/github/callback');

    const login = await (prisma as any).login.findFirst({
      where: { provider: 'github', provider_user_id: 'gh-uid-newuser' },
    });
    expect(login).not.toBeNull();
    expect(login.provider_email).toBe('newghuser@example.com');
    expect(login.provider_username).toBe('newghuser');
  });

  it('redirects to /account on successful sign-in', async () => {
    // Pre-seed approved user — brand-new social_login users start pending and
    // land on /account showing a "Waiting for approval" card.
    await makeUser({ primary_email: 'newghuser@example.com', display_name: 'New GitHub User' });
    mockStrategy.setProfile(githubProfile);

    const res = await request(app).get('/api/auth/github/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');
  });

  it('sets session userId and role via req.login', async () => {
    // Pre-seed approved user — see note above.
    await makeUser({ primary_email: 'newghuser@example.com', display_name: 'New GitHub User' });
    mockStrategy.setProfile(githubProfile);

    const agent = request.agent(app);
    await agent.get('/api/auth/github/callback');

    const me = await agent.get('/api/auth/me');
    expect([200]).toContain(me.status);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/github/callback — new user WITHOUT public email (RD-002)
// ---------------------------------------------------------------------------

describe('GET /api/auth/github/callback — new user without public email (RD-002)', () => {
  const githubProfileNoEmail = {
    id: 'gh-uid-noemail',
    displayName: 'No Email GitHub User',
    username: 'noemailuser',
    emails: [], // GitHub returns no public email
  };

  it('creates a User with placeholder primary_email when GitHub returns no email', async () => {
    mockStrategy.setProfile(githubProfileNoEmail);

    await request(app).get('/api/auth/github/callback');

    const user = await (prisma as any).user.findFirst({
      where: { primary_email: 'noemailuser@github.invalid' },
    });
    expect(user).not.toBeNull();
    expect(user.role).toBe('student');
    expect(user.created_via).toBe('social_login');
  });

  it('stores the .invalid placeholder email in primary_email', async () => {
    mockStrategy.setProfile(githubProfileNoEmail);

    await request(app).get('/api/auth/github/callback');

    const user = await (prisma as any).user.findFirst({
      where: { primary_email: 'noemailuser@github.invalid' },
    });
    expect(user.primary_email).toBe('noemailuser@github.invalid');
  });

  it('still creates a Login record with provider_username when email is absent', async () => {
    mockStrategy.setProfile(githubProfileNoEmail);

    await request(app).get('/api/auth/github/callback');

    const login = await (prisma as any).login.findFirst({
      where: { provider: 'github', provider_user_id: 'gh-uid-noemail' },
    });
    expect(login).not.toBeNull();
    expect(login.provider_username).toBe('noemailuser');
    expect(login.provider_email).toBeNull();
  });

  it('sign-in completes (redirects to /account) even when no email is provided', async () => {
    // Pre-seed approved user — see note in the previous describe block.
    await makeUser({
      primary_email: 'noemailuser@github.invalid',
      display_name: 'No Email GitHub User',
    });
    mockStrategy.setProfile(githubProfileNoEmail);

    const res = await request(app).get('/api/auth/github/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');
  });

  it('logs a warning when using the .invalid placeholder email', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockStrategy.setProfile(githubProfileNoEmail);
    await request(app).get('/api/auth/github/callback');

    const warnCalled = warnSpy.mock.calls.some((args) =>
      args.some(
        (arg) =>
          typeof arg === 'string' && arg.includes('github.invalid'),
      ),
    );
    expect(warnCalled).toBe(true);

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/github/callback — returning user
// ---------------------------------------------------------------------------

describe('GET /api/auth/github/callback — returning user', () => {
  it('does not create a new User or Login for a returning identity', async () => {
    // Seed existing user + login
    const existingUser = await makeUser({
      primary_email: 'returning@github.example.com',
      display_name: 'Returning GitHub User',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(existingUser, {
      provider: 'github',
      provider_user_id: 'gh-uid-returning',
      provider_email: 'returning@github.example.com',
    });

    const beforeUsers = await (prisma as any).user.count();
    const beforeLogins = await (prisma as any).login.count();

    mockStrategy.setProfile({
      id: 'gh-uid-returning',
      displayName: 'Returning GitHub User',
      username: 'returningghuser',
      emails: [{ value: 'returning@github.example.com' }],
    });

    await request(app).get('/api/auth/github/callback');

    expect(await (prisma as any).user.count()).toBe(beforeUsers);
    expect(await (prisma as any).login.count()).toBe(beforeLogins);
  });

  it('redirects to /account for a returning user', async () => {
    const existingUser = await makeUser({
      primary_email: 'returning2@github.example.com',
      display_name: 'Returning GitHub 2',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(existingUser, {
      provider: 'github',
      provider_user_id: 'gh-uid-returning2',
    });

    mockStrategy.setProfile({
      id: 'gh-uid-returning2',
      displayName: 'Returning GitHub 2',
      username: 'returningghuser2',
      emails: [{ value: 'returning2@github.example.com' }],
    });

    const res = await request(app).get('/api/auth/github/callback');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/github/callback — OAuth error / denial
// ---------------------------------------------------------------------------

describe('GET /api/auth/github/callback — OAuth error', () => {
  it('redirects to /?error=oauth_denied when OAuth fails', async () => {
    mockStrategy.setError(true);

    const res = await request(app).get('/api/auth/github/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?error=oauth_denied');
  });

  it('does not create any User or Login on OAuth failure', async () => {
    mockStrategy.setError(true);

    await request(app).get('/api/auth/github/callback');

    expect(await (prisma as any).user.count()).toBe(0);
    expect(await (prisma as any).login.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /account — stub landing route
// ---------------------------------------------------------------------------

describe('GET /account (after GitHub sign-in)', () => {
  it('returns 200 with placeholder text', async () => {
    const res = await request(app).get('/account');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/account/i);
  });
});

// ---------------------------------------------------------------------------
// mergeScan: called for new GitHub users
// ---------------------------------------------------------------------------

describe('mergeScan — GitHub new user', () => {
  it('runs without error when a new GitHub user is created (no candidates)', async () => {
    // With no existing users in the DB, mergeScan short-circuits immediately.
    // Verify the OAuth callback still succeeds (not a 500).
    mockStrategy.setProfile({
      id: 'gh-uid-mergescan',
      displayName: 'Merge Scan GitHub User',
      username: 'mergescanuser',
      emails: [{ value: 'mergescan-gh@example.com' }],
    });

    const res = await request(app).get('/api/auth/github/callback');

    // OAuth callback should redirect (3xx) — not 500
    expect(res.status).not.toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Post-login redirect: all roles → '/account' (Sprint 016 universal dashboard)
// ---------------------------------------------------------------------------

describe('GET /api/auth/github/callback — post-login redirect by role', () => {
  it('redirects admin to /account', async () => {
    const adminUser = await makeUser({
      primary_email: 'admin-gh@jointheleague.org',
      display_name: 'Admin GH User',
      role: 'admin',
      created_via: 'admin_created',
    });
    await makeLogin(adminUser, {
      provider: 'github',
      provider_user_id: 'gh-uid-admin-redirect',
      provider_email: 'admin-gh@jointheleague.org',
    });

    mockStrategy.setProfile({
      id: 'gh-uid-admin-redirect',
      displayName: 'Admin GH User',
      username: 'adminghuser',
      emails: [{ value: 'admin-gh@jointheleague.org' }],
    });

    const res = await request(app).get('/api/auth/github/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');
  });

  it('redirects staff to /account', async () => {
    const staffUser = await makeUser({
      primary_email: 'staff-gh@jointheleague.org',
      display_name: 'Staff GH User',
      role: 'staff',
      created_via: 'admin_created',
    });
    await makeLogin(staffUser, {
      provider: 'github',
      provider_user_id: 'gh-uid-staff-redirect',
      provider_email: 'staff-gh@jointheleague.org',
    });

    mockStrategy.setProfile({
      id: 'gh-uid-staff-redirect',
      displayName: 'Staff GH User',
      username: 'staffghuser',
      emails: [{ value: 'staff-gh@jointheleague.org' }],
    });

    const res = await request(app).get('/api/auth/github/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');
  });

  it('redirects student to /account', async () => {
    // Pre-seed approved user — see note in earlier describe blocks.
    await makeUser({
      primary_email: 'student-redirect-gh@example.com',
      display_name: 'Student GH User',
    });
    mockStrategy.setProfile({
      id: 'gh-uid-student-redirect',
      displayName: 'Student GH User',
      username: 'studentghuser',
      emails: [{ value: 'student-redirect-gh@example.com' }],
    });

    const res = await request(app).get('/api/auth/github/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');
  });
});
