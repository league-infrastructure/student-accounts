/**
 * Auth flow integration tests — T008.
 *
 * This file fills coverage gaps identified after T002–T007. Prior tickets
 * cover individual route and service behaviors in isolation. This file adds
 * cross-cutting scenario tests that exercise multiple pieces of the auth
 * stack together in narrative flows.
 *
 * New scenarios added here:
 *
 *  1. Sign-in → protected route → logout → protected route again (401 after
 *     logout confirms session is gone).
 *
 *  2. Cross-provider: same person signs in with Google (User A created), then
 *     signs in with GitHub (separate User B created — no auto-merge). Both
 *     merge-scan stub calls are logged. Verifies Sprint 007 deferral is safe.
 *
 *  3. Student authenticated via Google, hits a protected admin route → 403
 *     (authenticated but unauthorized — not 401).
 *
 *  4. @students.jointheleague.org via Google: role=student, OU lookup never
 *     invoked. Verified with a strict FakeAdminDirectoryClient that throws if
 *     it is ever called.
 *
 *  5. Duplicate-Login path: a Login already exists for a provider+userId when
 *     signInHandler is called. The existing User is returned and no new
 *     records are created (the findByProvider path, not the create path).
 *
 *  6. Session persists across multiple independent requests (cookie jar).
 */

import request from 'supertest';
import passport from 'passport';
import { Strategy as PassportStrategy } from 'passport-strategy';
import { prisma } from '../../server/src/services/prisma.js';
import { makeUser, makeLogin } from './helpers/factories.js';

process.env.NODE_ENV = 'test';

import app from '../../server/src/app.js';
import { signInHandler, type SignInOptions } from '../../server/src/services/auth/sign-in.handler.js';
import { AuditService } from '../../server/src/services/audit.service.js';
import { UserService } from '../../server/src/services/user.service.js';
import { LoginService } from '../../server/src/services/login.service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VerifyCallback = (
  accessToken: string,
  refreshToken: string,
  profile: any,
  done: (err: any, user?: any) => void,
) => void;

// ---------------------------------------------------------------------------
// MockGoogleStrategy (local copy — strategies are registered per test file
// and must not cross-contaminate other test files' passport state)
// ---------------------------------------------------------------------------

class MockGoogleStrategy extends PassportStrategy {
  name = 'google';
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
// MockGitHubStrategy (local copy)
// ---------------------------------------------------------------------------

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
// Verify-callback factories (mirror passport.config.ts logic for tests)
// ---------------------------------------------------------------------------

function makeGoogleVerifyCallback(
  userService: UserService,
  loginService: LoginService,
  signInOptions?: SignInOptions,
): VerifyCallback {
  return (_accessToken, _refreshToken, profile, done) => {
    const emails = profile.emails ?? [];
    const providerEmail = emails.find((e: any) => e.value)?.value ?? null;
    const displayName = profile.displayName || providerEmail || profile.id;

    signInHandler(
      'google',
      { providerUserId: profile.id, providerEmail, displayName, providerUsername: null },
      userService,
      loginService,
      signInOptions,
    )
      .then((user) => done(null, user))
      .catch((err) => done(err));
  };
}

function makeGitHubVerifyCallback(
  userService: UserService,
  loginService: LoginService,
): VerifyCallback {
  return (_accessToken, _refreshToken, profile, done) => {
    const emails = profile.emails ?? [];
    const providerEmail = emails.find((e: any) => e.value)?.value ?? null;
    const providerUsername = profile.username ?? null;
    const displayName = profile.displayName || providerUsername || providerEmail || profile.id;

    signInHandler(
      'github',
      { providerUserId: profile.id, providerEmail, displayName, providerUsername },
      userService,
      loginService,
    )
      .then((user) => done(null, user))
      .catch((err) => done(err));
  };
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

let mockGoogleStrategy: MockGoogleStrategy;
let mockGitHubStrategy: MockGitHubStrategy;
let userService: UserService;
let loginService: LoginService;
let auditService: AuditService;

async function cleanDb(): Promise<void> {
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
  // Save and set OAuth env vars so strategy gates don't return 501
  SAVED_ENV.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  SAVED_ENV.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  SAVED_ENV.GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;
  SAVED_ENV.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
  SAVED_ENV.GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
  SAVED_ENV.GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL;

  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id-flows';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret-flows';
  process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/auth/google/callback';
  process.env.GITHUB_CLIENT_ID = 'test-github-client-id-flows';
  process.env.GITHUB_CLIENT_SECRET = 'test-github-secret-flows';
  process.env.GITHUB_CALLBACK_URL = 'http://localhost:3000/api/auth/github/callback';

  auditService = new AuditService();
  userService = new UserService(prisma, auditService);
  loginService = new LoginService(prisma, auditService);

  mockGoogleStrategy = new MockGoogleStrategy(
    makeGoogleVerifyCallback(userService, loginService),
  );
  mockGitHubStrategy = new MockGitHubStrategy(
    makeGitHubVerifyCallback(userService, loginService),
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
  // Reset strategies to a clean state (no injected OU client)
  mockGoogleStrategy['_verifyCallback'] = makeGoogleVerifyCallback(userService, loginService);
  mockGitHubStrategy['_verifyCallback'] = makeGitHubVerifyCallback(userService, loginService);
});

// ---------------------------------------------------------------------------
// Scenario 1: Sign-in → hit protected admin route → logout → 401 on re-access
//
// Verifies the full authenticated session lifecycle in one narrative flow:
//   a. Google OAuth sign-in establishes a session.
//   b. Admin route (with requireAuth only, not requireRole) is accessible.
//   c. Logout destroys the session.
//   d. Same admin route returns 401 (no session).
//
// This test uses /api/auth/me as the protected probe because it uses
// requireAuth and is always mounted regardless of role.
// ---------------------------------------------------------------------------

describe('Scenario 1: full session lifecycle — sign-in → protected route → logout → 401', () => {
  it('establishes session on sign-in, allows access, then returns 401 after logout', async () => {
    const agent = request.agent(app);

    // Step 1: sign in via Google
    mockGoogleStrategy.setProfile({
      id: 'flow-uid-lifecycle',
      displayName: 'Lifecycle User',
      emails: [{ value: 'lifecycle@example.com' }],
    });

    const callbackRes = await agent.get('/api/auth/google/callback');
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.location).toBe('/account');

    // Step 2: session is active — /api/auth/me returns 200
    const meBeforeLogout = await agent.get('/api/auth/me');
    expect(meBeforeLogout.status).toBe(200);
    expect(meBeforeLogout.body).toHaveProperty('id');
    expect(meBeforeLogout.body.role).toBe('USER');

    // Step 3: logout destroys the session
    const logoutRes = await agent.post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body).toEqual({ success: true });

    // Step 4: session is gone — /api/auth/me returns 401
    const meAfterLogout = await agent.get('/api/auth/me');
    expect(meAfterLogout.status).toBe(401);
  });

  it('returns 401 on a protected admin route after logout (not just /api/auth/me)', async () => {
    const agent = request.agent(app);

    // Sign in as admin via the test-login shortcut (avoids needing admin OAuth)
    await agent.post('/api/auth/test-login').send({
      email: 'lifecycle-admin@example.com',
      displayName: 'Lifecycle Admin',
      role: 'admin',
    });

    // Confirm admin route is accessible
    const adminBefore = await agent.get('/api/admin/env');
    expect(adminBefore.status).toBe(200);

    // Logout
    await agent.post('/api/auth/logout');

    // Admin route now returns 401 (not 403 — no session at all)
    const adminAfter = await agent.get('/api/admin/env');
    expect(adminAfter.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Cross-provider — Google creates User A, GitHub creates User B
//
// Same person (same email contact in the real world) signs in with two
// different OAuth providers. Sprint 002 design: separate Login rows map to
// separate User rows. No auto-merge. mergeScan stub is called for each new
// User, logging the deferral for both. Sprint 007 will implement merge.
//
// This test verifies:
//   a. Google sign-in creates User A (role=student, provider=google).
//   b. GitHub sign-in creates User B (role=student, provider=github).
//   c. Two distinct User rows exist, not one merged row.
//   d. Two merge-scan deferral log messages are emitted (one per new User).
//   e. Each session shows its own userId.
// ---------------------------------------------------------------------------

describe('Scenario 2: cross-provider — Google User A and GitHub User B are separate accounts', () => {
  it('creates two distinct User rows for the same real person using different providers', async () => {
    // Google sign-in — creates User A
    mockGoogleStrategy.setProfile({
      id: 'cross-provider-google-uid',
      displayName: 'Cross Provider Person',
      emails: [{ value: 'crossperson@example.com' }],
    });
    await request(app).get('/api/auth/google/callback');

    // GitHub sign-in — creates User B (different email required; GitHub has own uid)
    mockGitHubStrategy.setProfile({
      id: 'cross-provider-github-uid',
      displayName: 'Cross Provider Person',
      username: 'crossperson',
      emails: [{ value: 'crossperson-gh@example.com' }],
    });
    await request(app).get('/api/auth/github/callback');

    // Two separate User records
    const users = await (prisma as any).user.findMany({
      orderBy: { id: 'asc' },
    });
    expect(users).toHaveLength(2);

    // Two separate Login records
    const logins = await (prisma as any).login.findMany({
      orderBy: { id: 'asc' },
    });
    expect(logins).toHaveLength(2);
    expect(logins[0].provider).toBe('google');
    expect(logins[1].provider).toBe('github');

    // Each Login points to a distinct User
    expect(logins[0].user_id).not.toBe(logins[1].user_id);
  });

  it('calls the merge-scan stub (logs deferral) for each new User created across providers', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockGoogleStrategy.setProfile({
      id: 'cross-mergescan-google-uid',
      displayName: 'Merge Scan Cross Person',
      emails: [{ value: 'crossmerge-google@example.com' }],
    });
    await request(app).get('/api/auth/google/callback');

    mockGitHubStrategy.setProfile({
      id: 'cross-mergescan-github-uid',
      displayName: 'Merge Scan Cross Person',
      username: 'crossmerge',
      emails: [{ value: 'crossmerge-github@example.com' }],
    });
    await request(app).get('/api/auth/github/callback');

    // merge-scan deferral should have been logged twice (once per new User)
    const mergeLogs = consoleSpy.mock.calls.filter((args) =>
      args.some(
        (arg) => typeof arg === 'string' && arg.includes('merge-scan deferred to Sprint 007'),
      ),
    );
    expect(mergeLogs.length).toBeGreaterThanOrEqual(2);

    consoleSpy.mockRestore();
  });

  it('each cross-provider session carries its own distinct userId', async () => {
    const googleAgent = request.agent(app);
    const githubAgent = request.agent(app);

    mockGoogleStrategy.setProfile({
      id: 'cross-session-google-uid',
      displayName: 'Cross Session Google',
      emails: [{ value: 'crosssession-google@example.com' }],
    });
    await googleAgent.get('/api/auth/google/callback');

    mockGitHubStrategy.setProfile({
      id: 'cross-session-github-uid',
      displayName: 'Cross Session GitHub',
      username: 'crosssessiongh',
      emails: [{ value: 'crosssession-github@example.com' }],
    });
    await githubAgent.get('/api/auth/github/callback');

    const googleMe = await googleAgent.get('/api/auth/me');
    const githubMe = await githubAgent.get('/api/auth/me');

    expect(googleMe.status).toBe(200);
    expect(githubMe.status).toBe(200);

    // Each agent has a different userId in their session
    expect(googleMe.body.id).not.toBe(githubMe.body.id);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Student hitting an admin-only route → 403 (not 401)
//
// A student is authenticated (has a session with userId and role=student).
// They attempt to access an admin-only route (/api/admin/env).
// The response must be 403 Forbidden — they ARE authenticated (not 401)
// but NOT authorized for the admin role.
// ---------------------------------------------------------------------------

describe('Scenario 3: authenticated student hits admin route → 403 (not 401)', () => {
  it('returns 403 (not 401) when a student hits an admin-only route', async () => {
    const agent = request.agent(app);

    // Sign in as a student
    mockGoogleStrategy.setProfile({
      id: 'student-admin-attempt-uid',
      displayName: 'Student Attempting Admin',
      emails: [{ value: 'student-admin-attempt@example.com' }],
    });
    await agent.get('/api/auth/google/callback');

    // Confirm session is active (student)
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('USER'); // student maps to 'USER' in /api/auth/me

    // Attempt admin route — must be 403, not 401
    const adminRes = await agent.get('/api/admin/env');
    expect(adminRes.status).toBe(403);
    expect(adminRes.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 401 for the same admin route when no session exists at all', async () => {
    // Bare request with no session cookie — must be 401, not 403
    const res = await request(app).get('/api/admin/env');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: @students.jointheleague.org via Google — OU lookup never called
//
// A student with a @students.jointheleague.org email signs in via Google.
// The sign-in handler must NOT call the Admin Directory client for this domain.
// We inject a strict FakeAdminDirectoryClient that throws if getUserOU() is
// called. The test passes only if no exception is thrown (i.e., the client
// is never invoked).
// ---------------------------------------------------------------------------

describe('Scenario 4: @students.jointheleague.org — OU lookup never invoked', () => {
  const STAFF_OU = '/League Staff';

  beforeEach(() => {
    process.env.GOOGLE_STAFF_OU_PATH = STAFF_OU;
  });

  afterEach(() => {
    delete process.env.GOOGLE_STAFF_OU_PATH;
  });

  it('does not invoke the Admin Directory client for @students.jointheleague.org', async () => {
    // A strict client that will fail the test if it is ever called.
    const strictClient = {
      getUserOU: async (email: string): Promise<string> => {
        throw new Error(
          `[T008] STRICT: getUserOU called for "${email}" — ` +
            'OU lookup must NOT be invoked for @students.jointheleague.org accounts',
        );
      },
    };

    // Wire the strict client into the verify callback
    mockGoogleStrategy['_verifyCallback'] = makeGoogleVerifyCallback(
      userService,
      loginService,
      { adminDirClient: strictClient as any },
    );

    mockGoogleStrategy.setProfile({
      id: 't008-students-domain-uid',
      displayName: 'Students Domain User',
      emails: [{ value: 'jane@students.jointheleague.org' }],
    });

    // If the strict client were called, the handler would throw and the
    // route would redirect to an error URL. We assert success instead.
    const res = await request(app).get('/api/auth/google/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');

    // User created with role=student (OU check never ran)
    const user = await (prisma as any).user.findFirst({
      where: { primary_email: 'jane@students.jointheleague.org' },
    });
    expect(user).not.toBeNull();
    expect(user.role).toBe('student');
  });

  it('assigns role=student (not staff) for @students.jointheleague.org regardless of client', async () => {
    // Double-check with a client that would return a staff OU if called.
    // The handler must ignore it because the domain does not match @jointheleague.org.
    let lookupCalled = false;
    const trackingClient = {
      getUserOU: async (_email: string): Promise<string> => {
        lookupCalled = true;
        return '/League Staff'; // Would grant staff if check ran
      },
    };

    mockGoogleStrategy['_verifyCallback'] = makeGoogleVerifyCallback(
      userService,
      loginService,
      { adminDirClient: trackingClient as any },
    );

    mockGoogleStrategy.setProfile({
      id: 't008-students-domain-uid2',
      displayName: 'Students Domain User 2',
      emails: [{ value: 'bob@students.jointheleague.org' }],
    });

    await request(app).get('/api/auth/google/callback');

    // Lookup must not have been called
    expect(lookupCalled).toBe(false);

    // Role must be student
    const user = await (prisma as any).user.findFirst({
      where: { primary_email: 'bob@students.jointheleague.org' },
    });
    expect(user).not.toBeNull();
    expect(user.role).toBe('student');
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Duplicate Login — existing Login found; existing User returned;
// no new records created; session established.
//
// The ticket acceptance criteria table lists this as:
//   "Duplicate Login (ConflictError) → Session established for existing User; no new records"
//
// In the current implementation, signInHandler calls loginService.findByProvider
// first; when a Login exists, it returns the associated User immediately without
// calling loginService.create. The ConflictError path in loginService.create is
// therefore a defensive guard against races. The primary test here is that the
// "existing Login found" path correctly establishes a session and creates no
// new records.
// ---------------------------------------------------------------------------

describe('Scenario 5: existing Login found — session established, no new records', () => {
  it('finds the existing User via Login and establishes a session (no new rows)', async () => {
    // Seed: existing user + google login
    const existingUser = await makeUser({
      primary_email: 'dup-login@example.com',
      display_name: 'Dup Login User',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(existingUser, {
      provider: 'google',
      provider_user_id: 'dup-login-google-uid',
      provider_email: 'dup-login@example.com',
    });

    const beforeUsers = await (prisma as any).user.count();
    const beforeLogins = await (prisma as any).login.count();

    const agent = request.agent(app);
    mockGoogleStrategy.setProfile({
      id: 'dup-login-google-uid',
      displayName: 'Dup Login User',
      emails: [{ value: 'dup-login@example.com' }],
    });

    // Sign in — should use the existing Login, not create new records
    const callbackRes = await agent.get('/api/auth/google/callback');
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.location).toBe('/account');

    // No new rows
    expect(await (prisma as any).user.count()).toBe(beforeUsers);
    expect(await (prisma as any).login.count()).toBe(beforeLogins);

    // Session is established for the existing user
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(existingUser.id);
  });

  it('does not call the merge-scan stub when an existing Login is found', async () => {
    const existingUser = await makeUser({
      primary_email: 'dup-no-merge@example.com',
      display_name: 'Dup No Merge',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(existingUser, {
      provider: 'google',
      provider_user_id: 'dup-no-merge-uid',
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockGoogleStrategy.setProfile({
      id: 'dup-no-merge-uid',
      displayName: 'Dup No Merge',
      emails: [{ value: 'dup-no-merge@example.com' }],
    });

    await request(app).get('/api/auth/google/callback');

    const mergeCalled = consoleSpy.mock.calls.some((args) =>
      args.some(
        (arg) => typeof arg === 'string' && arg.includes('merge-scan deferred to Sprint 007'),
      ),
    );
    expect(mergeCalled).toBe(false);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Session persistence across multiple requests (cookie jar)
//
// Using a supertest agent (which persists cookies), verifies that the session
// cookie is sent on subsequent requests and the user remains authenticated
// across several independent requests without re-signing in.
// ---------------------------------------------------------------------------

describe('Scenario 6: session persistence across multiple requests via cookie jar', () => {
  it('remains authenticated across three consecutive requests', async () => {
    const agent = request.agent(app);

    // Sign in
    mockGoogleStrategy.setProfile({
      id: 'session-persist-uid',
      displayName: 'Session Persist User',
      emails: [{ value: 'session-persist@example.com' }],
    });
    await agent.get('/api/auth/google/callback');

    // Request 1: /api/auth/me → 200
    const r1 = await agent.get('/api/auth/me');
    expect(r1.status).toBe(200);
    const userId = r1.body.id;

    // Request 2: /api/auth/me again → still 200, same userId
    const r2 = await agent.get('/api/auth/me');
    expect(r2.status).toBe(200);
    expect(r2.body.id).toBe(userId);

    // Request 3: another endpoint that requires auth → still 200, same userId
    const r3 = await agent.get('/api/auth/me');
    expect(r3.status).toBe(200);
    expect(r3.body.id).toBe(userId);
  });

  it('a new agent (no cookie jar) cannot access a protected route', async () => {
    // The authenticated agent's session is not shared with a plain request
    const agent = request.agent(app);

    mockGoogleStrategy.setProfile({
      id: 'session-isolation-uid',
      displayName: 'Session Isolation User',
      emails: [{ value: 'session-isolation@example.com' }],
    });
    await agent.get('/api/auth/google/callback');

    // Authenticated agent: 200
    const authenticatedRes = await agent.get('/api/auth/me');
    expect(authenticatedRes.status).toBe(200);

    // New sessionless request: 401
    const anonymousRes = await request(app).get('/api/auth/me');
    expect(anonymousRes.status).toBe(401);
  });
});
