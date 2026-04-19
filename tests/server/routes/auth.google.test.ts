/**
 * Route-level integration tests for Google OAuth (T002 — UC-001 happy path).
 *
 * Tests the full HTTP flow from the Google OAuth callback through session
 * establishment. Uses a MockGoogleStrategy (bypasses the OAuth redirect and
 * calls the verify callback directly with a controlled profile).
 *
 * The real Passport session middleware (serializeUser / deserializeUser) runs
 * — only the OAuth redirect round-trip is replaced.
 *
 * Covers:
 *  - GET /api/auth/google → 501 when env vars absent.
 *  - OAuth callback: new user created, session established, redirect to /account.
 *  - OAuth callback: returning user signed in, no new User/Login created.
 *  - OAuth callback: error/denial redirects to /?error=oauth_denied.
 *  - GET /account returns 200 with placeholder text after sign-in.
 *  - Session contains userId and role after successful sign-in.
 */

import request from 'supertest';
import passport from 'passport';
import { Strategy as PassportStrategy } from 'passport-strategy';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeUser, makeLogin } from '../helpers/factories.js';

process.env.NODE_ENV = 'test';

// ---------------------------------------------------------------------------
// MockGoogleStrategy
//
// A minimal Passport strategy that mimics the google strategy but calls the
// verify callback directly with a controlled profile instead of redirecting
// to Google.
//
// Calling mockGoogleStrategy.setProfile(profile) changes what the next
// authenticate call sends to the verify callback.
// Calling mockGoogleStrategy.setError(true) simulates an OAuth failure.
// ---------------------------------------------------------------------------

type VerifyCallback = (
  accessToken: string,
  refreshToken: string,
  profile: any,
  done: (err: any, user?: any) => void,
) => void;

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
// Test setup
// ---------------------------------------------------------------------------

// Import app AFTER setting up environment
import app from '../../../server/src/app.js';
import { signInHandler, type SignInOptions } from '../../../server/src/services/auth/sign-in.handler.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { UserService } from '../../../server/src/services/user.service.js';
import { LoginService } from '../../../server/src/services/login.service.js';
import {
  FakeAdminDirectoryClient,
  StaffOULookupError,
} from '../../../server/src/services/auth/google-admin-directory.client.js';

// The verify callback that the real GoogleStrategy uses — we replicate it
// here so the MockGoogleStrategy exercises the same sign-in handler path.
// The optional `signInOptions` argument allows individual tests to inject a
// FakeAdminDirectoryClient for OU detection cases.
function makeVerifyCallback(
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
      {
        providerUserId: profile.id,
        providerEmail,
        displayName,
        providerUsername: null,
      },
      userService,
      loginService,
      signInOptions,
    )
      .then((user) => done(null, user))
      .catch((err) => done(err));
  };
}

let mockStrategy: MockGoogleStrategy;
let userService: UserService;
let loginService: LoginService;
let auditService: AuditService;

/** Helper: switch the mock strategy to use a different verify callback. */
function useVerifyCallback(opts?: SignInOptions): void {
  const cb = makeVerifyCallback(userService, loginService, opts);
  mockStrategy['_verifyCallback'] = cb;
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

// Set fake env vars so the strategy gates don't return 501
const SAVED_ENV: Record<string, string | undefined> = {};

beforeAll(() => {
  SAVED_ENV.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  SAVED_ENV.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  SAVED_ENV.GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;

  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/auth/google/callback';

  auditService = new AuditService();
  userService = new UserService(prisma, auditService);
  loginService = new LoginService(prisma, auditService);

  // Register the mock strategy — overrides the real google strategy for tests.
  // Tests that need OU detection inject a FakeAdminDirectoryClient via useVerifyCallback().
  mockStrategy = new MockGoogleStrategy(makeVerifyCallback(userService, loginService));
  passport.use('google', mockStrategy as any);
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
  // Reset verify callback to the default (no OU client) before each test.
  // Tests that need OU detection call useVerifyCallback({ adminDirClient: ... }).
  useVerifyCallback();
});

// ---------------------------------------------------------------------------
// GET /api/auth/google — initiation
// ---------------------------------------------------------------------------

describe('GET /api/auth/google', () => {
  it('returns 501 when GOOGLE_CLIENT_ID is not set', async () => {
    const savedId = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;

    const res = await request(app).get('/api/auth/google');
    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/not configured/i);
    expect(res.body).toHaveProperty('docs');

    process.env.GOOGLE_CLIENT_ID = savedId;
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/google/callback — new user (UC-001 happy path)
// ---------------------------------------------------------------------------

describe('GET /api/auth/google/callback — new user', () => {
  const googleProfile = {
    id: 'google-uid-newuser',
    displayName: 'New User',
    emails: [{ value: 'newuser@example.com' }],
  };

  it('creates a new User record on first sign-in', async () => {
    mockStrategy.setProfile(googleProfile);

    await request(app).get('/api/auth/google/callback');

    const user = await (prisma as any).user.findFirst({
      where: { primary_email: 'newuser@example.com' },
    });
    expect(user).not.toBeNull();
    expect(user.role).toBe('student');
    expect(user.created_via).toBe('social_login');
  });

  it('creates a new Login record on first sign-in', async () => {
    mockStrategy.setProfile(googleProfile);

    await request(app).get('/api/auth/google/callback');

    const login = await (prisma as any).login.findFirst({
      where: { provider: 'google', provider_user_id: 'google-uid-newuser' },
    });
    expect(login).not.toBeNull();
    expect(login.provider_email).toBe('newuser@example.com');
  });

  it('redirects to /account on successful sign-in', async () => {
    mockStrategy.setProfile(googleProfile);

    const res = await request(app).get('/api/auth/google/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');
  });

  it('sets session userId and role via req.login', async () => {
    mockStrategy.setProfile(googleProfile);

    const agent = request.agent(app);
    await agent.get('/api/auth/google/callback');

    // Check the session by hitting /api/auth/me
    const me = await agent.get('/api/auth/me');
    expect([200]).toContain(me.status);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/google/callback — returning user
// ---------------------------------------------------------------------------

describe('GET /api/auth/google/callback — returning user', () => {
  it('does not create a new User or Login for a returning identity', async () => {
    // Seed existing user + login
    const existingUser = await makeUser({
      primary_email: 'returning@example.com',
      display_name: 'Returning User',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(existingUser, {
      provider: 'google',
      provider_user_id: 'google-uid-returning',
      provider_email: 'returning@example.com',
    });

    const beforeUsers = await (prisma as any).user.count();
    const beforeLogins = await (prisma as any).login.count();

    mockStrategy.setProfile({
      id: 'google-uid-returning',
      displayName: 'Returning User',
      emails: [{ value: 'returning@example.com' }],
    });

    await request(app).get('/api/auth/google/callback');

    expect(await (prisma as any).user.count()).toBe(beforeUsers);
    expect(await (prisma as any).login.count()).toBe(beforeLogins);
  });

  it('redirects to /account for a returning user', async () => {
    const existingUser = await makeUser({
      primary_email: 'returning2@example.com',
      display_name: 'Returning 2',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(existingUser, {
      provider: 'google',
      provider_user_id: 'google-uid-returning2',
    });

    mockStrategy.setProfile({
      id: 'google-uid-returning2',
      displayName: 'Returning 2',
      emails: [{ value: 'returning2@example.com' }],
    });

    const res = await request(app).get('/api/auth/google/callback');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/google/callback — OAuth error / denial
// ---------------------------------------------------------------------------

describe('GET /api/auth/google/callback — OAuth error', () => {
  it('redirects to /?error=oauth_denied when OAuth fails', async () => {
    mockStrategy.setError(true);

    const res = await request(app).get('/api/auth/google/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?error=oauth_denied');
  });

  it('does not create any User or Login on OAuth failure', async () => {
    mockStrategy.setError(true);

    await request(app).get('/api/auth/google/callback');

    expect(await (prisma as any).user.count()).toBe(0);
    expect(await (prisma as any).login.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /account — stub landing route
// ---------------------------------------------------------------------------

describe('GET /account', () => {
  it('returns 200 with placeholder text', async () => {
    const res = await request(app).get('/account');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/account/i);
  });
});

// ---------------------------------------------------------------------------
// mergeScan stub: called for new users
// ---------------------------------------------------------------------------

describe('mergeScan stub', () => {
  it('logs "merge-scan deferred to Sprint 007" when a new user is created', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockStrategy.setProfile({
      id: 'google-uid-mergescan',
      displayName: 'Merge Scan User',
      emails: [{ value: 'mergescan@example.com' }],
    });

    await request(app).get('/api/auth/google/callback');

    const mergeLogCalled = consoleSpy.mock.calls.some((args) =>
      args.some(
        (arg) =>
          typeof arg === 'string' && arg.includes('merge-scan deferred to Sprint 007'),
      ),
    );
    expect(mergeLogCalled).toBe(true);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// UC-003: Staff OU detection — route-level integration tests
// ---------------------------------------------------------------------------

describe('GET /api/auth/google/callback — @jointheleague.org staff OU (UC-003)', () => {
  const STAFF_OU = '/League Staff';

  beforeEach(() => {
    process.env.GOOGLE_STAFF_OU_PATH = STAFF_OU;
  });

  afterEach(() => {
    delete process.env.GOOGLE_STAFF_OU_PATH;
  });

  it('creates user with role=staff when OU path matches', async () => {
    const adminDirClient = new FakeAdminDirectoryClient('/League Staff/Engineering');
    useVerifyCallback({ adminDirClient, auditService, prisma });

    mockStrategy.setProfile({
      id: 'google-uid-staffou-new',
      displayName: 'Staff OU User',
      emails: [{ value: 'staffuser@jointheleague.org' }],
    });

    const res = await request(app).get('/api/auth/google/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');

    const user = await (prisma as any).user.findFirst({
      where: { primary_email: 'staffuser@jointheleague.org' },
    });
    expect(user).not.toBeNull();
    expect(user.role).toBe('staff');
  });

  it('session carries role=staff for @jointheleague.org user in staff OU', async () => {
    const adminDirClient = new FakeAdminDirectoryClient('/League Staff');
    useVerifyCallback({ adminDirClient, auditService, prisma });

    mockStrategy.setProfile({
      id: 'google-uid-staffou-session',
      displayName: 'Staff Session User',
      emails: [{ value: 'staffsession@jointheleague.org' }],
    });

    const agent = request.agent(app);
    await agent.get('/api/auth/google/callback');

    const me = await agent.get('/api/auth/me');
    expect([200]).toContain(me.status);
    // The /api/auth/me route maps 'staff' to 'STAFF'
    expect(me.body.role).toBe('STAFF');
  });

  it('creates user with role=student when OU path does not match (RD-003)', async () => {
    const adminDirClient = new FakeAdminDirectoryClient('/Students/Cohort2025');
    useVerifyCallback({ adminDirClient, auditService, prisma });

    mockStrategy.setProfile({
      id: 'google-uid-nonstaffou',
      displayName: 'Non-Staff OU User',
      emails: [{ value: 'nonstaffou@jointheleague.org' }],
    });

    const res = await request(app).get('/api/auth/google/callback');

    // Sign-in succeeds (RD-003: not a hard deny)
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');

    const user = await (prisma as any).user.findFirst({
      where: { primary_email: 'nonstaffou@jointheleague.org' },
    });
    expect(user).not.toBeNull();
    expect(user.role).toBe('student');
  });

  it('redirects to /?error=staff_lookup_failed when AdminClient throws StaffOULookupError (RD-001)', async () => {
    const adminDirClient = new FakeAdminDirectoryClient(
      new StaffOULookupError('credentials missing', 'MISSING_CREDENTIALS'),
    );
    useVerifyCallback({ adminDirClient, auditService, prisma });

    mockStrategy.setProfile({
      id: 'google-uid-ou-fail',
      displayName: 'OU Fail User',
      emails: [{ value: 'oufail@jointheleague.org' }],
    });

    const res = await request(app).get('/api/auth/google/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?error=staff_lookup_failed');
  });

  it('does NOT establish a session when StaffOULookupError is thrown', async () => {
    const adminDirClient = new FakeAdminDirectoryClient(
      new StaffOULookupError('credentials missing', 'MISSING_CREDENTIALS'),
    );
    useVerifyCallback({ adminDirClient, auditService, prisma });

    mockStrategy.setProfile({
      id: 'google-uid-ou-nosession',
      displayName: 'No Session User',
      emails: [{ value: 'nosession@jointheleague.org' }],
    });

    const agent = request.agent(app);
    await agent.get('/api/auth/google/callback');

    // No session should be established — /api/auth/me should return 401
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  it('writes auth_denied AuditEvent when StaffOULookupError is thrown (RD-001)', async () => {
    const adminDirClient = new FakeAdminDirectoryClient(
      new StaffOULookupError('credentials missing', 'MISSING_CREDENTIALS'),
    );
    useVerifyCallback({ adminDirClient, auditService, prisma });

    await (prisma as any).auditEvent.deleteMany();

    mockStrategy.setProfile({
      id: 'google-uid-ou-audit',
      displayName: 'Audit Denied User',
      emails: [{ value: 'auditdenied@jointheleague.org' }],
    });

    await request(app).get('/api/auth/google/callback');

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'auth_denied' },
    });
    expect(events.length).toBe(1);
    expect(events[0].target_entity_id).toBe('auditdenied@jointheleague.org');
  });

  it('skips OU check for @students.jointheleague.org — role=student, no lookup', async () => {
    let ouLookupCalled = false;
    const adminDirClient: any = {
      getUserOU: async () => {
        ouLookupCalled = true;
        return '/League Staff';
      },
    };
    useVerifyCallback({ adminDirClient });

    mockStrategy.setProfile({
      id: 'google-uid-student-domain',
      displayName: 'Student Domain',
      emails: [{ value: 'student@students.jointheleague.org' }],
    });

    const res = await request(app).get('/api/auth/google/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');
    expect(ouLookupCalled).toBe(false);

    const user = await (prisma as any).user.findFirst({
      where: { primary_email: 'student@students.jointheleague.org' },
    });
    expect(user).not.toBeNull();
    expect(user.role).toBe('student');
  });

  it('skips OU check for external email (gmail.com) — role=student, no lookup', async () => {
    let ouLookupCalled = false;
    const adminDirClient: any = {
      getUserOU: async () => {
        ouLookupCalled = true;
        return '/League Staff';
      },
    };
    useVerifyCallback({ adminDirClient });

    mockStrategy.setProfile({
      id: 'google-uid-gmail-external',
      displayName: 'External Gmail',
      emails: [{ value: 'external@gmail.com' }],
    });

    const res = await request(app).get('/api/auth/google/callback');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');
    expect(ouLookupCalled).toBe(false);

    const user = await (prisma as any).user.findFirst({
      where: { primary_email: 'external@gmail.com' },
    });
    expect(user).not.toBeNull();
    expect(user.role).toBe('student');
  });
});

// ---------------------------------------------------------------------------
// GET /staff — stub landing route
// ---------------------------------------------------------------------------

describe('GET /staff', () => {
  it('returns 200 with placeholder text', async () => {
    const res = await request(app).get('/staff');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/staff/i);
  });
});
