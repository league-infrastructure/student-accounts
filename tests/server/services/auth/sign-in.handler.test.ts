/**
 * Integration tests for signInHandler (T002 — UC-001 happy path).
 *
 * Covers:
 *  - New Google user: User + Login + AuditEvents created atomically.
 *  - Returning Google user: no new User or Login created; existing User returned.
 *  - mergeScan stub is called (log output captured).
 *  - Non-@jointheleague.org email: role stays 'student' (no OU check).
 *  - handler is a pure function: no Express types in signature.
 */

import { prisma } from '../../../../server/src/services/prisma.js';
import { AuditService } from '../../../../server/src/services/audit.service.js';
import { UserService } from '../../../../server/src/services/user.service.js';
import { LoginService } from '../../../../server/src/services/login.service.js';
import { signInHandler } from '../../../../server/src/services/auth/sign-in.handler.js';
import {
  FakeAdminDirectoryClient,
  StaffOULookupError,
} from '../../../../server/src/services/auth/google-admin-directory.client.js';
import { makeUser, makeLogin } from '../../helpers/factories.js';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

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

beforeEach(async () => {
  await cleanDb();
  userService = new UserService(prisma, new AuditService());
  loginService = new LoginService(prisma, new AuditService());
});

afterAll(async () => {
  await cleanDb();
});

// ---------------------------------------------------------------------------
// Helper: count rows
// ---------------------------------------------------------------------------
async function countUsers(): Promise<number> {
  return (prisma as any).user.count();
}

async function countLogins(): Promise<number> {
  return (prisma as any).login.count();
}

async function countAuditEvents(): Promise<number> {
  return (prisma as any).auditEvent.count();
}

// ---------------------------------------------------------------------------
// UC-001: New Google user — creates User + Login + AuditEvents
// ---------------------------------------------------------------------------

describe('signInHandler — new Google user (UC-001)', () => {
  const profile = {
    providerUserId: 'google-uid-001',
    providerEmail: 'alice@example.com',
    displayName: 'Alice Example',
    providerUsername: null,
  };

  it('creates a new User with role=student and created_via=social_login', async () => {
    const user = await signInHandler('google', profile, userService, loginService);

    expect(user.id).toBeDefined();
    expect(user.primary_email).toBe('alice@example.com');
    expect(user.display_name).toBe('Alice Example');
    expect(user.role).toBe('student');
    expect(user.created_via).toBe('social_login');
  });

  it('creates a new Login record linked to the User', async () => {
    const user = await signInHandler('google', profile, userService, loginService);

    const login = await loginService.findByProvider('google', 'google-uid-001');
    expect(login).not.toBeNull();
    expect(login!.user_id).toBe(user.id);
    expect(login!.provider).toBe('google');
    expect(login!.provider_user_id).toBe('google-uid-001');
    expect(login!.provider_email).toBe('alice@example.com');
  });

  it('creates exactly 1 User and 1 Login for a brand-new identity', async () => {
    await signInHandler('google', profile, userService, loginService);

    expect(await countUsers()).toBe(1);
    expect(await countLogins()).toBe(1);
  });

  it('records create_user and add_login AuditEvents atomically', async () => {
    await signInHandler('google', profile, userService, loginService);

    const events = await (prisma as any).auditEvent.findMany({
      orderBy: { id: 'asc' },
    });
    const actions = events.map((e: any) => e.action);
    expect(actions).toContain('create_user');
    expect(actions).toContain('add_login');
  });

  it('calls the merge-scan stub (logs deferral message)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await signInHandler('google', profile, userService, loginService);

    const mergeLogCalled = consoleSpy.mock.calls.some((args) =>
      args.some(
        (arg) => typeof arg === 'string' && arg.includes('merge-scan deferred to Sprint 007'),
      ),
    );
    expect(mergeLogCalled).toBe(true);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// UC-001 returning variant: known Google identity — no new records
// ---------------------------------------------------------------------------

describe('signInHandler — returning Google user', () => {
  it('returns the existing User without creating new User or Login rows', async () => {
    // Seed: existing user + login
    const existingUser = await makeUser({
      primary_email: 'bob@example.com',
      display_name: 'Bob',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(existingUser, {
      provider: 'google',
      provider_user_id: 'google-uid-bob',
      provider_email: 'bob@example.com',
    });

    const beforeUsers = await countUsers();
    const beforeLogins = await countLogins();

    const user = await signInHandler(
      'google',
      {
        providerUserId: 'google-uid-bob',
        providerEmail: 'bob@example.com',
        displayName: 'Bob Updated Name',
        providerUsername: null,
      },
      userService,
      loginService,
    );

    // Same user returned
    expect(user.id).toBe(existingUser.id);
    expect(user.primary_email).toBe('bob@example.com');

    // No new rows created
    expect(await countUsers()).toBe(beforeUsers);
    expect(await countLogins()).toBe(beforeLogins);
  });

  it('does not write AuditEvents for a returning user', async () => {
    const existingUser = await makeUser({
      primary_email: 'carol@example.com',
      display_name: 'Carol',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(existingUser, {
      provider: 'google',
      provider_user_id: 'google-uid-carol',
    });
    // Clear any seeding-related audit events
    await (prisma as any).auditEvent.deleteMany();

    await signInHandler(
      'google',
      {
        providerUserId: 'google-uid-carol',
        providerEmail: 'carol@example.com',
        displayName: 'Carol',
        providerUsername: null,
      },
      userService,
      loginService,
    );

    expect(await countAuditEvents()).toBe(0);
  });

  it('does not call the merge-scan stub for a returning user', async () => {
    const existingUser = await makeUser({
      primary_email: 'dave@example.com',
      display_name: 'Dave',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(existingUser, {
      provider: 'google',
      provider_user_id: 'google-uid-dave',
      provider_email: 'dave@example.com',
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await signInHandler(
      'google',
      {
        providerUserId: 'google-uid-dave',
        providerEmail: 'dave@example.com',
        displayName: 'Dave',
        providerUsername: null,
      },
      userService,
      loginService,
    );

    const mergeLogCalled = consoleSpy.mock.calls.some((args) =>
      args.some(
        (arg) => typeof arg === 'string' && arg.includes('merge-scan deferred to Sprint 007'),
      ),
    );
    expect(mergeLogCalled).toBe(false);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Non-@jointheleague.org Google account → role stays student (RD-003 seam)
// ---------------------------------------------------------------------------

describe('signInHandler — non-jointheleague.org Google account', () => {
  it('assigns role=student for a gmail.com account', async () => {
    const user = await signInHandler(
      'google',
      {
        providerUserId: 'google-uid-gmail',
        providerEmail: 'student@gmail.com',
        displayName: 'Gmail Student',
        providerUsername: null,
      },
      userService,
      loginService,
    );

    expect(user.role).toBe('student');
  });

  it('assigns role=student for a custom domain (non-league) account', async () => {
    const user = await signInHandler(
      'google',
      {
        providerUserId: 'google-uid-custom',
        providerEmail: 'person@school.edu',
        displayName: 'School Person',
        providerUsername: null,
      },
      userService,
      loginService,
    );

    expect(user.role).toBe('student');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('signInHandler — edge cases', () => {
  it('uses providerUserId as display name fallback when displayName is empty', async () => {
    const user = await signInHandler(
      'google',
      {
        providerUserId: 'google-uid-nodisplay',
        providerEmail: null,
        displayName: '',
        providerUsername: null,
      },
      userService,
      loginService,
    );

    // Falls back to email, then providerUserId
    expect(user.display_name).toBeTruthy();
    expect(user.display_name.length).toBeGreaterThan(0);
  });

  it('uses a synthetic email when provider returns no email', async () => {
    const user = await signInHandler(
      'google',
      {
        providerUserId: 'google-uid-noemail',
        providerEmail: null,
        displayName: 'No Email User',
        providerUsername: null,
      },
      userService,
      loginService,
    );

    // Should not crash; email field has a value
    expect(user.primary_email).toBeTruthy();
    expect(user.primary_email.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// UC-003: Staff OU detection for @jointheleague.org accounts
// ---------------------------------------------------------------------------

describe('signInHandler — @jointheleague.org staff OU detection (UC-003)', () => {
  const STAFF_OU = '/League Staff';

  beforeEach(() => {
    process.env.GOOGLE_STAFF_OU_PATH = STAFF_OU;
  });

  afterEach(() => {
    delete process.env.GOOGLE_STAFF_OU_PATH;
  });

  it('sets role=staff when OU path matches GOOGLE_STAFF_OU_PATH', async () => {
    const adminDirClient = new FakeAdminDirectoryClient('/League Staff/Engineering');

    const user = await signInHandler(
      'google',
      {
        providerUserId: 'google-uid-staff-001',
        providerEmail: 'alice@jointheleague.org',
        displayName: 'Alice Staff',
        providerUsername: null,
      },
      userService,
      loginService,
      { adminDirClient },
    );

    expect(user.role).toBe('staff');
  });

  it('sets role=staff when OU path exactly equals GOOGLE_STAFF_OU_PATH', async () => {
    const adminDirClient = new FakeAdminDirectoryClient('/League Staff');

    const user = await signInHandler(
      'google',
      {
        providerUserId: 'google-uid-staff-002',
        providerEmail: 'bob@jointheleague.org',
        displayName: 'Bob Staff',
        providerUsername: null,
      },
      userService,
      loginService,
      { adminDirClient },
    );

    expect(user.role).toBe('staff');
  });

  it('sets role=student when OU path does not match (RD-003)', async () => {
    const adminDirClient = new FakeAdminDirectoryClient('/Students/Spring2025');

    const user = await signInHandler(
      'google',
      {
        providerUserId: 'google-uid-nonstaffou',
        providerEmail: 'carol@jointheleague.org',
        displayName: 'Carol Not In Staff OU',
        providerUsername: null,
      },
      userService,
      loginService,
      { adminDirClient },
    );

    expect(user.role).toBe('student');
  });

  it('throws StaffOULookupError when AdminClient fails (RD-001)', async () => {
    const adminDirClient = new FakeAdminDirectoryClient(
      new StaffOULookupError('credentials missing', 'MISSING_CREDENTIALS'),
    );

    await expect(
      signInHandler(
        'google',
        {
          providerUserId: 'google-uid-fail',
          providerEmail: 'fail@jointheleague.org',
          displayName: 'Fail User',
          providerUsername: null,
        },
        userService,
        loginService,
        { adminDirClient },
      ),
    ).rejects.toThrow(StaffOULookupError);
  });

  it('writes auth_denied AuditEvent when StaffOULookupError is thrown (RD-001)', async () => {
    const auditService = new AuditService();
    const adminDirClient = new FakeAdminDirectoryClient(
      new StaffOULookupError('credentials missing', 'MISSING_CREDENTIALS'),
    );

    await (prisma as any).auditEvent.deleteMany();

    await expect(
      signInHandler(
        'google',
        {
          providerUserId: 'google-uid-audit',
          providerEmail: 'audit@jointheleague.org',
          displayName: 'Audit User',
          providerUsername: null,
        },
        userService,
        loginService,
        { adminDirClient, auditService, prisma },
      ),
    ).rejects.toThrow(StaffOULookupError);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'auth_denied' },
    });
    expect(events.length).toBe(1);
    expect(events[0].target_entity_id).toBe('audit@jointheleague.org');
  });

  it('does NOT call adminDirClient for @students.jointheleague.org accounts', async () => {
    let ouLookupCalled = false;
    const adminDirClient: any = {
      getUserOU: async (_email: string) => {
        ouLookupCalled = true;
        return '/Students';
      },
    };

    const user = await signInHandler(
      'google',
      {
        providerUserId: 'google-uid-student-domain',
        providerEmail: 'student@students.jointheleague.org',
        displayName: 'Student Domain User',
        providerUsername: null,
      },
      userService,
      loginService,
      { adminDirClient },
    );

    expect(ouLookupCalled).toBe(false);
    expect(user.role).toBe('student');
  });

  it('does NOT call adminDirClient for external (gmail.com) accounts', async () => {
    let ouLookupCalled = false;
    const adminDirClient: any = {
      getUserOU: async (_email: string) => {
        ouLookupCalled = true;
        return '/League Staff';
      },
    };

    const user = await signInHandler(
      'google',
      {
        providerUserId: 'google-uid-gmail-ext',
        providerEmail: 'external@gmail.com',
        displayName: 'External User',
        providerUsername: null,
      },
      userService,
      loginService,
      { adminDirClient },
    );

    expect(ouLookupCalled).toBe(false);
    expect(user.role).toBe('student');
  });

  it('updates role to staff on subsequent sign-in when OU matches (returning user)', async () => {
    // Seed a returning user who previously had student role
    const existingUser = await makeUser({
      primary_email: 'returning-staff@jointheleague.org',
      display_name: 'Returning Staff',
      role: 'student',
      created_via: 'social_login',
    });
    await makeLogin(existingUser, {
      provider: 'google',
      provider_user_id: 'google-uid-returning-staff',
      provider_email: 'returning-staff@jointheleague.org',
    });

    const adminDirClient = new FakeAdminDirectoryClient('/League Staff/Engineering');

    const user = await signInHandler(
      'google',
      {
        providerUserId: 'google-uid-returning-staff',
        providerEmail: 'returning-staff@jointheleague.org',
        displayName: 'Returning Staff',
        providerUsername: null,
      },
      userService,
      loginService,
      { adminDirClient },
    );

    // Role should be promoted to staff even for a returning user
    expect(user.role).toBe('staff');
  });
});
