/**
 * Integration tests for POST /api/auth/login (Sprint 015 T006).
 *
 * Public endpoint — no auth required. Accepts username + password and
 * establishes a session on success.
 *
 * Uses the real SQLite test database via the shared Prisma client.
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import { hashPassword } from '../../../server/src/utils/password.js';

process.env.NODE_ENV = 'test';

import app from '../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
});

// ===========================================================================
// Happy path
// ===========================================================================

describe('POST /api/auth/login — happy path', () => {
  it('returns 200 with user fields, sets session cookie, /me returns user', async () => {
    const passwordHash = await hashPassword('purple-cactus-river');
    const user = await (prisma as any).user.create({
      data: {
        username: 'alice',
        password_hash: passwordHash,
        display_name: 'Alice',
        primary_email: 'alice@example.com',
        role: 'student',
        is_active: true,
        created_via: 'admin_created',
      },
    });

    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'purple-cactus-river' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
    expect(res.body.username).toBe('alice');
    expect(res.body.displayName).toBe('Alice');
    expect(res.body.primaryEmail).toBe('alice@example.com');
    expect(res.body.role).toBe('student');

    // Session cookie should be set — subsequent /me returns user
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.id).toBe(user.id);
  });
});

// ===========================================================================
// Wrong password
// ===========================================================================

describe('POST /api/auth/login — wrong password', () => {
  it('returns 401 with generic message, no session set', async () => {
    const passwordHash = await hashPassword('correct-horse-battery');
    await (prisma as any).user.create({
      data: {
        username: 'bob',
        password_hash: passwordHash,
        display_name: 'Bob',
        primary_email: 'bob@example.com',
        role: 'student',
        is_active: true,
        created_via: 'admin_created',
      },
    });

    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/login')
      .send({ username: 'bob', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid username or password');

    // No session — /me should return 401
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(401);
  });
});

// ===========================================================================
// Unknown username
// ===========================================================================

describe('POST /api/auth/login — unknown username', () => {
  it('returns 401 with identical body to wrong-password case', async () => {
    const wrongPasswordRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'no-such-user', password: 'anything' });

    expect(wrongPasswordRes.status).toBe(401);
    expect(wrongPasswordRes.body.error).toBe('Invalid username or password');
  });

  it('unknown-username body exactly matches wrong-password body', async () => {
    const passwordHash = await hashPassword('right-pass');
    await (prisma as any).user.create({
      data: {
        username: 'carol',
        password_hash: passwordHash,
        display_name: 'Carol',
        primary_email: 'carol@example.com',
        role: 'student',
        is_active: true,
        created_via: 'admin_created',
      },
    });

    const wrongPassRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'carol', password: 'wrong-pass' });

    const unknownUserRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'no-such-user', password: 'anything' });

    expect(wrongPassRes.status).toBe(401);
    expect(unknownUserRes.status).toBe(401);
    // Both bodies must be identical — no enumeration leakage
    expect(wrongPassRes.body).toEqual(unknownUserRes.body);
  });
});

// ===========================================================================
// Inactive user
// ===========================================================================

describe('POST /api/auth/login — inactive user', () => {
  it('returns 401 with generic message even if password is correct', async () => {
    const passwordHash = await hashPassword('active-pass');
    await (prisma as any).user.create({
      data: {
        username: 'dave',
        password_hash: passwordHash,
        display_name: 'Dave',
        primary_email: 'dave@example.com',
        role: 'student',
        is_active: false,
        created_via: 'admin_created',
      },
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dave', password: 'active-pass' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid username or password');
  });
});

// ===========================================================================
// OAuth-only user (password_hash = null)
// ===========================================================================

describe('POST /api/auth/login — OAuth-only user (no password_hash)', () => {
  it('returns 401 with generic message', async () => {
    await (prisma as any).user.create({
      data: {
        username: 'eve',
        password_hash: null,
        display_name: 'Eve',
        primary_email: 'eve@example.com',
        role: 'student',
        is_active: true,
        created_via: 'social_login',
      },
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'eve', password: 'anything' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid username or password');
  });
});

// ===========================================================================
// Missing fields
// ===========================================================================

describe('POST /api/auth/login — missing fields', () => {
  it('returns 401 for empty body', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid username or password');
  });

  it('returns 401 for missing username', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'some-pass' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid username or password');
  });

  it('returns 401 for missing password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid username or password');
  });
});

// ===========================================================================
// Username case-insensitivity
// ===========================================================================

describe('POST /api/auth/login — username case-insensitivity', () => {
  it('logs in with mixed-case username for a lowercase-stored user', async () => {
    const passwordHash = await hashPassword('my-secret');
    const user = await (prisma as any).user.create({
      data: {
        username: 'alice',
        password_hash: passwordHash,
        display_name: 'Alice',
        primary_email: 'alice2@example.com',
        role: 'student',
        is_active: true,
        created_via: 'admin_created',
      },
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'Alice', password: 'my-secret' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
  });
});

// ===========================================================================
// End-to-end: passphrase-signup → login
// ===========================================================================

describe('POST /api/auth/login — end-to-end signup then login', () => {
  it('user created via passphrase-signup can log in with the same credentials', async () => {
    // Need a cohort with a valid passphrase to sign up
    const cohort = await (prisma as any).cohort.create({
      data: { name: 'E2E Cohort', google_ou_path: '/Test/E2E' },
    });
    const now = new Date();
    await (prisma as any).cohort.update({
      where: { id: cohort.id },
      data: {
        signup_passphrase: 'login-e2e-phrase',
        signup_passphrase_grant_llm_proxy: false,
        signup_passphrase_expires_at: new Date(now.getTime() + 3_600_000),
        signup_passphrase_created_at: now,
        signup_passphrase_created_by: null,
      },
    });

    // Step 1: Sign up
    const signupRes = await request(app)
      .post('/api/auth/passphrase-signup')
      .send({
        username: 'bob',
        passphrase: 'login-e2e-phrase',
        password: 'e2e-secure-password',
        displayName: 'Bob E2E',
        email: 'bob-e2e@test.example.com',
      });

    expect(signupRes.status).toBe(200);
    expect(signupRes.body.username).toBe('bob');

    // Log in with the password (not the passphrase)
    const loginAgent = request.agent(app);
    const loginRes = await loginAgent
      .post('/api/auth/login')
      .send({ username: 'bob', password: 'e2e-secure-password' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.username).toBe('bob');
    expect(loginRes.body.id).toBe(signupRes.body.id);

    // Session should be active
    const meRes = await loginAgent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.id).toBe(signupRes.body.id);
  });
});

// ===========================================================================
// Group passphrase used as a login password (membership-scoped)
// ===========================================================================

describe('POST /api/auth/login — group passphrase as password', () => {
  const future = () => new Date(Date.now() + 3_600_000);
  const past = () => new Date(Date.now() - 1_000);

  async function makeGroupMember(opts: {
    username: string;
    email: string;
    passphrase: string;
    expiresAt: Date;
    member: boolean;
    passwordHash?: string | null;
  }) {
    const group = await (prisma as any).group.create({
      data: {
        name: `Class-${opts.username}`,
        signup_passphrase: opts.passphrase,
        signup_passphrase_grant_llm_proxy: false,
        signup_passphrase_expires_at: opts.expiresAt,
        signup_passphrase_created_at: new Date(),
        signup_passphrase_created_by: null,
      },
    });
    const user = await (prisma as any).user.create({
      data: {
        username: opts.username,
        password_hash: opts.passwordHash ?? null,
        display_name: opts.username,
        primary_email: opts.email,
        role: 'student',
        is_active: true,
        created_via: 'admin_created',
      },
    });
    if (opts.member) {
      await (prisma as any).userGroup.create({
        data: { user_id: user.id, group_id: group.id },
      });
    }
    return { group, user };
  }

  it('lets a group member sign in using the active group passphrase', async () => {
    const { user } = await makeGroupMember({
      username: 'g-member',
      email: 'g-member@example.com',
      passphrase: 'orange-pencil-cloud',
      expiresAt: future(),
      member: true,
      passwordHash: await hashPassword('their-real-password'),
    });

    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/login')
      .send({ username: 'g-member', password: 'orange-pencil-cloud' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
  });

  it('rejects the passphrase for a non-member (401)', async () => {
    await makeGroupMember({
      username: 'non-member',
      email: 'non-member@example.com',
      passphrase: 'silver-kite-meadow',
      expiresAt: future(),
      member: false,
      passwordHash: await hashPassword('real-pw'),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'non-member', password: 'silver-kite-meadow' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid username or password');
  });

  it('rejects an EXPIRED passphrase even for a member (401)', async () => {
    await makeGroupMember({
      username: 'expired-member',
      email: 'expired@example.com',
      passphrase: 'frozen-lake-stone',
      expiresAt: past(),
      member: true,
      passwordHash: await hashPassword('real-pw'),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'expired-member', password: 'frozen-lake-stone' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid username or password');
  });

  it('lets a member with no password sign in via the passphrase', async () => {
    const { user } = await makeGroupMember({
      username: 'oauth-member',
      email: 'oauth-member@example.com',
      passphrase: 'golden-river-fox',
      expiresAt: future(),
      member: true,
      passwordHash: null,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'oauth-member', password: 'golden-river-fox' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
  });

  it('still accepts the real password when a passphrase also exists', async () => {
    const { user } = await makeGroupMember({
      username: 'both-creds',
      email: 'both@example.com',
      passphrase: 'maple-window-tide',
      expiresAt: future(),
      member: true,
      passwordHash: await hashPassword('the-real-one'),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'both-creds', password: 'the-real-one' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
  });
});

// ===========================================================================
// Identifier may be the primary email
// ===========================================================================

describe('POST /api/auth/login — login by email', () => {
  it('logs in when the identifier is the primary email', async () => {
    const passwordHash = await hashPassword('email-login-pw');
    const user = await (prisma as any).user.create({
      data: {
        username: 'emailuser',
        password_hash: passwordHash,
        display_name: 'Email User',
        primary_email: 'email-login@example.com',
        role: 'student',
        is_active: true,
        created_via: 'admin_created',
      },
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'email-login@example.com', password: 'email-login-pw' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
  });
});
