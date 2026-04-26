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
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
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
      .send({ username: 'bob', passphrase: 'login-e2e-phrase' });

    expect(signupRes.status).toBe(200);
    expect(signupRes.body.username).toBe('bob');

    // The passphrase becomes the password_hash — log in with it
    const loginAgent = request.agent(app);
    const loginRes = await loginAgent
      .post('/api/auth/login')
      .send({ username: 'bob', password: 'login-e2e-phrase' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.username).toBe('bob');
    expect(loginRes.body.id).toBe(signupRes.body.id);

    // Session should be active
    const meRes = await loginAgent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.id).toBe(signupRes.body.id);
  });
});
