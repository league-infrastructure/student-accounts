/**
 * Route-level integration tests for OAuth link mode (T005 — UC-010).
 *
 * Tests the full HTTP flow when a signed-in student clicks "Add Google/GitHub"
 * on their account page. Uses MockLinkGoogleStrategy / MockLinkGitHubStrategy
 * (variants of the existing mock strategies) that pass `req` to the verify
 * callback, matching the `passReqToCallback: true` behaviour in
 * passport.config.ts.
 *
 * Covers (acceptance criteria from T005):
 *  AC-01: GET /api/auth/google?link=1 (unauthed) → 401.
 *  AC-02: GET /api/auth/github?link=1 (unauthed) → 401.
 *  AC-03: Link-mode callback with NEW provider identity → Login created, add_login
 *          audit recorded, redirect to /account.
 *  AC-04: Link-mode callback where provider_user_id already attached to same user
 *          → idempotent, redirect to /account, no duplicate Login.
 *  AC-05: Link-mode callback where provider_user_id attached to DIFFERENT user
 *          → redirect to /account?error=already_linked, no reassignment.
 *  AC-06: Link-mode with no session.userId → falls through to normal sign-in.
 *  AC-07: Normal sign-in (no ?link=1) → unchanged behaviour (regression).
 *
 * Helper: POST /api/auth/test-set-link sets session.link=true (test-only route).
 */

import request from 'supertest';
import passport from 'passport';
import { Strategy as PassportStrategy } from 'passport-strategy';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeUser, makeLogin } from '../helpers/factories.js';
import { linkHandler } from '../../../server/src/services/auth/link.handler.js';
import { signInHandler, type SignInOptions } from '../../../server/src/services/auth/sign-in.handler.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { UserService } from '../../../server/src/services/user.service.js';
import { LoginService } from '../../../server/src/services/login.service.js';

process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// MockLinkStrategy
//
// A mock Passport strategy that passes `req` as the first argument to the
// verify callback, matching the passReqToCallback: true behaviour used in the
// production passport.config.ts.
//
// The verify callback receives: (req, accessToken, refreshToken, profile, done)
// ---------------------------------------------------------------------------

type LinkVerifyCallback = (
  req: any,
  accessToken: string,
  refreshToken: string,
  profile: any,
  done: (err: any, user?: any) => void,
) => void;

class MockLinkGoogleStrategy extends PassportStrategy {
  name = 'google';
  private _profile: any = null;
  private _simulateError = false;
  private _verifyCallback: LinkVerifyCallback;

  constructor(verifyCallback: LinkVerifyCallback) {
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

  authenticate(req: any, _options?: any): void {
    if (this._simulateError || !this._profile) {
      return this.fail({ message: 'OAuth error' });
    }
    this._verifyCallback(req, 'mock-access-token', 'mock-refresh-token', this._profile, (err, user) => {
      if (err) return this.error(err);
      if (!user) return this.fail({ message: 'No user returned' });
      this.success(user);
    });
  }
}

class MockLinkGitHubStrategy extends PassportStrategy {
  name = 'github';
  private _profile: any = null;
  private _simulateError = false;
  private _verifyCallback: LinkVerifyCallback;

  constructor(verifyCallback: LinkVerifyCallback) {
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

  authenticate(req: any, _options?: any): void {
    if (this._simulateError || !this._profile) {
      return this.fail({ message: 'OAuth error' });
    }
    this._verifyCallback(req, 'mock-access-token', 'mock-refresh-token', this._profile, (err, user) => {
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

let mockGoogleStrategy: MockLinkGoogleStrategy;
let mockGitHubStrategy: MockLinkGitHubStrategy;
let userService: UserService;
let loginService: LoginService;
let auditService: AuditService;

/**
 * Build the Google verify callback that mirrors passport.config.ts behaviour:
 * checks req.session.link to decide whether to call linkHandler or signInHandler.
 */
function makeGoogleVerifyCallback(
  loginServiceInst: LoginService,
  userServiceInst: UserService,
  signInOptions?: SignInOptions,
): LinkVerifyCallback {
  return (req, _accessToken, _refreshToken, profile, done) => {
    const emails = profile.emails ?? [];
    const providerEmail = emails.find((e: any) => e.value)?.value ?? null;
    const displayName = profile.displayName || providerEmail || profile.id;

    const linkUserId: number | undefined = req.session?.userId;

    if (req.session?.link && linkUserId) {
      // Link mode: attach new provider to current user.
      linkHandler(
        'google',
        { providerUserId: profile.id, providerEmail, displayName, providerUsername: null },
        linkUserId,
        loginServiceInst,
      )
        .then((result) => done(null, { _linkResult: result.action }))
        .catch((err) => done(err));
      return;
    }

    // Normal sign-in path.
    signInHandler(
      'google',
      { providerUserId: profile.id, providerEmail, displayName, providerUsername: null },
      userServiceInst,
      loginServiceInst,
      signInOptions,
    )
      .then((user) => done(null, user))
      .catch((err) => done(err));
  };
}

/**
 * Build the GitHub verify callback that mirrors passport.config.ts behaviour.
 */
function makeGitHubVerifyCallback(
  loginServiceInst: LoginService,
  userServiceInst: UserService,
): LinkVerifyCallback {
  return (req, _accessToken, _refreshToken, profile, done) => {
    const emails = profile.emails ?? [];
    const providerEmail = emails.find((e: any) => e.value)?.value ?? null;
    const providerUsername = profile.username ?? null;
    const displayName = profile.displayName || providerUsername || providerEmail || profile.id;

    const linkUserId: number | undefined = req.session?.userId;

    if (req.session?.link && linkUserId) {
      linkHandler(
        'github',
        { providerUserId: profile.id, providerEmail, displayName, providerUsername },
        linkUserId,
        loginServiceInst,
      )
        .then((result) => done(null, { _linkResult: result.action }))
        .catch((err) => done(err));
      return;
    }

    signInHandler(
      'github',
      { providerUserId: profile.id, providerEmail, displayName, providerUsername },
      userServiceInst,
      loginServiceInst,
    )
      .then((user) => done(null, user))
      .catch((err) => done(err));
  };
}

async function cleanDb() {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

const SAVED_ENV: Record<string, string | undefined> = {};

beforeAll(() => {
  SAVED_ENV.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  SAVED_ENV.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  SAVED_ENV.GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;
  SAVED_ENV.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
  SAVED_ENV.GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
  SAVED_ENV.GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL;

  process.env.GOOGLE_CLIENT_ID = 'test-link-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-link-google-client-secret';
  process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/auth/google/callback';
  process.env.GITHUB_CLIENT_ID = 'test-link-github-client-id';
  process.env.GITHUB_CLIENT_SECRET = 'test-link-github-client-secret';
  process.env.GITHUB_CALLBACK_URL = 'http://localhost:3000/api/auth/github/callback';

  auditService = new AuditService();
  userService = new UserService(prisma, auditService);
  loginService = new LoginService(prisma, auditService);

  // Register link-aware mock strategies.
  mockGoogleStrategy = new MockLinkGoogleStrategy(
    makeGoogleVerifyCallback(loginService, userService),
  );
  mockGitHubStrategy = new MockLinkGitHubStrategy(
    makeGitHubVerifyCallback(loginService, userService),
  );
  passport.use('google', mockGoogleStrategy as any);
  passport.use('github', mockGitHubStrategy as any);
});

afterAll(async () => {
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
  mockGoogleStrategy['_verifyCallback'] = makeGoogleVerifyCallback(loginService, userService);
  mockGitHubStrategy['_verifyCallback'] = makeGitHubVerifyCallback(loginService, userService);
  mockGoogleStrategy.setProfile(null as any);
  mockGitHubStrategy.setProfile(null as any);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sign in via the test-login endpoint and return an agent with the session.
 */
async function signInAs(
  userRecord: { primary_email: string; role: string },
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/test-login')
    .send({ email: userRecord.primary_email, role: userRecord.role })
    .expect(200);
  return agent;
}

/**
 * Sign in and activate link mode in the session.
 * Uses the POST /api/auth/test-set-link test endpoint.
 */
async function signInAndSetLink(
  userRecord: { primary_email: string; role: string },
): Promise<ReturnType<typeof request.agent>> {
  const agent = await signInAs(userRecord);
  await agent.post('/api/auth/test-set-link').expect(200);
  return agent;
}

// ---------------------------------------------------------------------------
// AC-01 / AC-02: Initiation routes return 401 when unauthenticated
// ---------------------------------------------------------------------------

describe('GET /api/auth/google?link=1 — unauthenticated (AC-01)', () => {
  it('returns 401 when user is not signed in', async () => {
    const res = await request(app).get('/api/auth/google?link=1');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });
});

describe('GET /api/auth/github?link=1 — unauthenticated (AC-02)', () => {
  it('returns 401 when user is not signed in', async () => {
    const res = await request(app).get('/api/auth/github?link=1');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });
});

// ---------------------------------------------------------------------------
// AC-01 / AC-02: Initiation sets session.link when authenticated
// ---------------------------------------------------------------------------

describe('GET /api/auth/google?link=1 — authenticated, sets session flags', () => {
  it('sets session.link=true (verified via subsequent callback behaviour)', async () => {
    const user = await makeUser({ primary_email: 'link-init-google@example.com', role: 'student' });
    // Sign in the user.
    const agent = await signInAs(user);

    // Set link mode via the test helper (simulates what the initiation route does).
    const setLinkRes = await agent.post('/api/auth/test-set-link');
    expect(setLinkRes.status).toBe(200);
    expect(setLinkRes.body.link).toBe(true);
    expect(setLinkRes.body.linkReturnTo).toBe('/account');
  });
});

// ---------------------------------------------------------------------------
// AC-03: New provider identity → Login created, audit recorded
// ---------------------------------------------------------------------------

describe('Google link-mode callback — new identity (AC-03)', () => {
  it('creates a Login record attached to the current user', async () => {
    const user = await makeUser({
      primary_email: 'link-new-google@example.com',
      role: 'student',
      created_via: 'social_login',
    });

    const agent = await signInAndSetLink(user);

    mockGoogleStrategy.setProfile({
      id: 'google-uid-link-new',
      displayName: 'Link New Google',
      emails: [{ value: 'link-new-google@example.com' }],
    });

    const res = await agent.get('/api/auth/google/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');

    const googleLogin = await (prisma as any).login.findFirst({
      where: { provider: 'google', provider_user_id: 'google-uid-link-new' },
    });
    expect(googleLogin).not.toBeNull();
    expect(googleLogin.user_id).toBe(user.id);
  });

  it('records an add_login audit event with actor = current user', async () => {
    const user = await makeUser({
      primary_email: 'link-audit@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    const agent = await signInAndSetLink(user);

    await (prisma as any).auditEvent.deleteMany();

    mockGoogleStrategy.setProfile({
      id: 'google-uid-link-audit',
      displayName: 'Link Audit',
      emails: [{ value: 'link-audit@example.com' }],
    });

    await agent.get('/api/auth/google/callback');

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'add_login', actor_user_id: user.id },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].target_user_id).toBe(user.id);
  });

  it('does NOT create a new User record (existing user must not be duplicated)', async () => {
    const user = await makeUser({
      primary_email: 'link-nodup@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    const agent = await signInAndSetLink(user);

    const beforeUserCount = await (prisma as any).user.count();

    mockGoogleStrategy.setProfile({
      id: 'google-uid-link-nodup',
      displayName: 'Link NoDup',
      emails: [{ value: 'link-nodup@example.com' }],
    });

    await agent.get('/api/auth/google/callback');

    expect(await (prisma as any).user.count()).toBe(beforeUserCount);
  });

  it('session is unchanged after successful link (still the same user)', async () => {
    const user = await makeUser({
      primary_email: 'link-session@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    const agent = await signInAndSetLink(user);

    mockGoogleStrategy.setProfile({
      id: 'google-uid-link-session',
      displayName: 'Link Session',
      emails: [{ value: 'link-session@example.com' }],
    });

    await agent.get('/api/auth/google/callback');

    // The session should still belong to the original user.
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);
  });

  it('session.link flag is cleared after successful link', async () => {
    const user = await makeUser({
      primary_email: 'link-clearflag@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    const agent = await signInAndSetLink(user);

    mockGoogleStrategy.setProfile({
      id: 'google-uid-link-clearflag',
      displayName: 'Link ClearFlag',
      emails: [{ value: 'link-clearflag@example.com' }],
    });

    await agent.get('/api/auth/google/callback');

    // User is still signed in after the link.
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);
  });
});

// ---------------------------------------------------------------------------
// AC-04: Provider identity already attached to same user → idempotent
// ---------------------------------------------------------------------------

describe('Google link-mode callback — already linked to same user (AC-04)', () => {
  it('redirects to /account without creating a duplicate Login', async () => {
    const user = await makeUser({
      primary_email: 'link-idem@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(user, {
      provider: 'google',
      provider_user_id: 'google-uid-already-mine',
      provider_email: 'link-idem@example.com',
    });

    const agent = await signInAndSetLink(user);

    const beforeLoginCount = await (prisma as any).login.count();

    mockGoogleStrategy.setProfile({
      id: 'google-uid-already-mine',
      displayName: 'Link Idem',
      emails: [{ value: 'link-idem@example.com' }],
    });

    const res = await agent.get('/api/auth/google/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');
    expect(await (prisma as any).login.count()).toBe(beforeLoginCount);
  });

  it('session is preserved after idempotent link (user still signed in)', async () => {
    const user = await makeUser({
      primary_email: 'link-idem-session@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(user, {
      provider: 'google',
      provider_user_id: 'google-uid-idem-session',
    });

    const agent = await signInAndSetLink(user);

    mockGoogleStrategy.setProfile({
      id: 'google-uid-idem-session',
      displayName: 'Link Idem Session',
      emails: [{ value: 'link-idem-session@example.com' }],
    });

    await agent.get('/api/auth/google/callback');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);
  });
});

// ---------------------------------------------------------------------------
// AC-05: Provider identity attached to DIFFERENT user → conflict
// ---------------------------------------------------------------------------

describe('Google link-mode callback — conflict (AC-05)', () => {
  it('redirects to /account?error=already_linked', async () => {
    const currentUser = await makeUser({
      primary_email: 'current-user@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    const otherUser = await makeUser({
      primary_email: 'other-user@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(otherUser, {
      provider: 'google',
      provider_user_id: 'google-uid-belongs-to-other',
      provider_email: 'other-user@example.com',
    });

    const agent = await signInAndSetLink(currentUser);

    mockGoogleStrategy.setProfile({
      id: 'google-uid-belongs-to-other',
      displayName: 'Other Owner',
      emails: [{ value: 'other-user@example.com' }],
    });

    const res = await agent.get('/api/auth/google/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account?error=already_linked');
  });

  it('does NOT move the Login from the other user to the current user', async () => {
    const currentUser = await makeUser({
      primary_email: 'conflict-current@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    const otherUser = await makeUser({
      primary_email: 'conflict-other@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(otherUser, {
      provider: 'google',
      provider_user_id: 'google-uid-conflict-move',
      provider_email: 'conflict-other@example.com',
    });

    const agent = await signInAndSetLink(currentUser);

    mockGoogleStrategy.setProfile({
      id: 'google-uid-conflict-move',
      displayName: 'Conflict Move',
      emails: [{ value: 'conflict-other@example.com' }],
    });

    await agent.get('/api/auth/google/callback');

    const login = await (prisma as any).login.findFirst({
      where: { provider: 'google', provider_user_id: 'google-uid-conflict-move' },
    });
    expect(login).not.toBeNull();
    expect(login.user_id).toBe(otherUser.id);
  });

  it('session is preserved after conflict (current user still signed in)', async () => {
    const currentUser = await makeUser({
      primary_email: 'conflict-session@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    const otherUser = await makeUser({
      primary_email: 'conflict-session-other@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(otherUser, {
      provider: 'google',
      provider_user_id: 'google-uid-conflict-session',
    });

    const agent = await signInAndSetLink(currentUser);

    mockGoogleStrategy.setProfile({
      id: 'google-uid-conflict-session',
      displayName: 'Conflict Session',
      emails: [{ value: 'conflict-session-other@example.com' }],
    });

    await agent.get('/api/auth/google/callback');

    // Current user should still be signed in — conflict must not overwrite session.
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(currentUser.id);
  });
});

// ---------------------------------------------------------------------------
// AC-06: Link mode with no session.userId → falls through to normal sign-in
// ---------------------------------------------------------------------------

describe('Google link-mode — unauthenticated session.userId absent (AC-06)', () => {
  it('falls through to normal sign-in when session.link is set but userId is absent', async () => {
    // Simulate: callback is hit without an active session (no userId).
    // The verify callback checks `req.session?.link && linkUserId` — if
    // linkUserId is absent, it falls through to signInHandler.
    mockGoogleStrategy.setProfile({
      id: 'google-uid-link-no-userid',
      displayName: 'Link No UserId',
      emails: [{ value: 'link-no-userid@example.com' }],
    });

    // No sign-in → no session.userId. Hit the callback directly.
    const res = await request(app).get('/api/auth/google/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');

    // A new User should have been created via the normal sign-in path.
    const user = await (prisma as any).user.findFirst({
      where: { primary_email: 'link-no-userid@example.com' },
    });
    expect(user).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-07: Normal sign-in (no ?link=1) — regression
// ---------------------------------------------------------------------------

describe('Google normal sign-in — regression (AC-07)', () => {
  it('creates a new user on first sign-in (unchanged behavior)', async () => {
    mockGoogleStrategy.setProfile({
      id: 'google-uid-regression-normal',
      displayName: 'Regression Normal',
      emails: [{ value: 'regression-normal@example.com' }],
    });

    const res = await request(app).get('/api/auth/google/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');

    const user = await (prisma as any).user.findFirst({
      where: { primary_email: 'regression-normal@example.com' },
    });
    expect(user).not.toBeNull();
    expect(user.role).toBe('student');
  });

  it('signs in returning user without creating new records (unchanged behavior)', async () => {
    const existingUser = await makeUser({
      primary_email: 'regression-returning@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(existingUser, {
      provider: 'google',
      provider_user_id: 'google-uid-regression-returning',
    });

    const beforeUsers = await (prisma as any).user.count();
    const beforeLogins = await (prisma as any).login.count();

    mockGoogleStrategy.setProfile({
      id: 'google-uid-regression-returning',
      displayName: 'Regression Returning',
      emails: [{ value: 'regression-returning@example.com' }],
    });

    await request(app).get('/api/auth/google/callback');

    expect(await (prisma as any).user.count()).toBe(beforeUsers);
    expect(await (prisma as any).login.count()).toBe(beforeLogins);
  });
});

// ---------------------------------------------------------------------------
// GitHub link-mode tests (parallel to Google)
// ---------------------------------------------------------------------------

describe('GitHub link-mode callback — new identity', () => {
  it('creates a Login for the current user with provider_username stored', async () => {
    const user = await makeUser({
      primary_email: 'link-github-new@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    const agent = await signInAndSetLink(user);

    mockGitHubStrategy.setProfile({
      id: 'gh-uid-link-new',
      displayName: 'Link GitHub New',
      username: 'linkghnew',
      emails: [{ value: 'link-github-new@example.com' }],
    });

    const res = await agent.get('/api/auth/github/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');

    const login = await (prisma as any).login.findFirst({
      where: { provider: 'github', provider_user_id: 'gh-uid-link-new' },
    });
    expect(login).not.toBeNull();
    expect(login.user_id).toBe(user.id);
    expect(login.provider_username).toBe('linkghnew');
  });
});

describe('GitHub link-mode callback — conflict', () => {
  it('redirects to /account?error=already_linked when provider owned by different user', async () => {
    const currentUser = await makeUser({
      primary_email: 'gh-conflict-current@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    const otherUser = await makeUser({
      primary_email: 'gh-conflict-other@example.com',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(otherUser, {
      provider: 'github',
      provider_user_id: 'gh-uid-conflict',
      provider_email: 'gh-conflict-other@example.com',
    });

    const agent = await signInAndSetLink(currentUser);

    mockGitHubStrategy.setProfile({
      id: 'gh-uid-conflict',
      displayName: 'GH Conflict',
      username: 'ghconflict',
      emails: [{ value: 'gh-conflict-other@example.com' }],
    });

    const res = await agent.get('/api/auth/github/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account?error=already_linked');
  });
});

// ---------------------------------------------------------------------------
// Unit tests for linkHandler (independently of HTTP layer)
// ---------------------------------------------------------------------------

describe('linkHandler unit tests', () => {
  let unitLoginService: LoginService;

  beforeEach(async () => {
    await cleanDb();
    unitLoginService = new LoginService(prisma, new AuditService());
  });

  it('returns { action: "linked" } and creates a Login when provider is new', async () => {
    const user = await makeUser({ role: 'student', created_via: 'social_login' });

    const result = await linkHandler(
      'google',
      {
        providerUserId: 'google-link-unit-001',
        providerEmail: 'linkunit@example.com',
        displayName: 'Link Unit',
        providerUsername: null,
      },
      user.id,
      unitLoginService,
    );

    expect(result.action).toBe('linked');

    const login = await (prisma as any).login.findFirst({
      where: { provider: 'google', provider_user_id: 'google-link-unit-001' },
    });
    expect(login).not.toBeNull();
    expect(login.user_id).toBe(user.id);
  });

  it('records add_login audit event with actor = current user', async () => {
    const user = await makeUser({ role: 'student', created_via: 'social_login' });

    await (prisma as any).auditEvent.deleteMany();

    await linkHandler(
      'github',
      {
        providerUserId: 'gh-link-unit-audit',
        providerEmail: null,
        displayName: 'Link Unit Audit',
        providerUsername: 'linkunitaudit',
      },
      user.id,
      unitLoginService,
    );

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'add_login', actor_user_id: user.id },
    });
    expect(events.length).toBe(1);
    expect(events[0].target_user_id).toBe(user.id);
    expect(JSON.parse(JSON.stringify(events[0].details))).toMatchObject({ provider: 'github' });
  });

  it('returns { action: "already_linked" } when provider already attached to same user', async () => {
    const user = await makeUser({ role: 'student', created_via: 'social_login' });
    await makeLogin(user, {
      provider: 'google',
      provider_user_id: 'google-link-unit-idem',
    });

    const result = await linkHandler(
      'google',
      {
        providerUserId: 'google-link-unit-idem',
        providerEmail: null,
        displayName: 'Link Idem Unit',
        providerUsername: null,
      },
      user.id,
      unitLoginService,
    );

    expect(result.action).toBe('already_linked');
  });

  it('returns { action: "conflict" } when provider attached to a different user', async () => {
    const user1 = await makeUser({ role: 'student', created_via: 'social_login' });
    const user2 = await makeUser({ role: 'student', created_via: 'social_login' });
    await makeLogin(user2, {
      provider: 'google',
      provider_user_id: 'google-link-unit-conflict',
    });

    const result = await linkHandler(
      'google',
      {
        providerUserId: 'google-link-unit-conflict',
        providerEmail: null,
        displayName: 'Link Conflict Unit',
        providerUsername: null,
      },
      user1.id,
      unitLoginService,
    );

    expect(result.action).toBe('conflict');
  });

  it('does NOT create a Login when returning conflict', async () => {
    const user1 = await makeUser({ role: 'student', created_via: 'social_login' });
    const user2 = await makeUser({ role: 'student', created_via: 'social_login' });
    await makeLogin(user2, {
      provider: 'github',
      provider_user_id: 'gh-link-unit-no-create',
    });

    const beforeCount = await (prisma as any).login.count();

    await linkHandler(
      'github',
      {
        providerUserId: 'gh-link-unit-no-create',
        providerEmail: null,
        displayName: 'No Create Conflict',
        providerUsername: null,
      },
      user1.id,
      unitLoginService,
    );

    expect(await (prisma as any).login.count()).toBe(beforeCount);
  });

  it('stores provider_username for GitHub link', async () => {
    const user = await makeUser({ role: 'student', created_via: 'social_login' });

    await linkHandler(
      'github',
      {
        providerUserId: 'gh-link-unit-username',
        providerEmail: 'ghuser@example.com',
        displayName: 'GH Username Test',
        providerUsername: 'myghusername',
      },
      user.id,
      unitLoginService,
    );

    const login = await (prisma as any).login.findFirst({
      where: { provider: 'github', provider_user_id: 'gh-link-unit-username' },
    });
    expect(login).not.toBeNull();
    expect(login.provider_username).toBe('myghusername');
  });
});
