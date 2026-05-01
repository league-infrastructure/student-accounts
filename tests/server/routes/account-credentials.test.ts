/**
 * Integration tests for PATCH /api/account/credentials (Sprint 020 T003).
 *
 * Uses the real SQLite test database via the shared Prisma client.
 * Auth is exercised via /api/auth/test-login.
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import { hashPassword, verifyPassword } from '../../../server/src/utils/password.js';

process.env.NODE_ENV = 'test';

import app from '../../../server/src/app.js';

// ---------------------------------------------------------------------------
// DB helpers
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

/**
 * Create a passphrase-credentialed user directly in the DB and return their id.
 */
async function makePassphraseUser(opts: {
  email: string;
  username: string;
  password: string;
  role?: 'student' | 'staff' | 'admin';
}): Promise<number> {
  const passwordHash = await hashPassword(opts.password);
  const user = await (prisma as any).user.create({
    data: {
      display_name: opts.username,
      primary_email: opts.email,
      username: opts.username,
      password_hash: passwordHash,
      role: opts.role ?? 'student',
      created_via: 'passphrase_signup',
      is_active: true,
      onboarding_completed: true,
      approval_status: 'approved',
    },
  });
  // Create a passphrase login record so the user has at least one login.
  await (prisma as any).login.create({
    data: {
      user_id: user.id,
      provider: 'passphrase',
      provider_user_id: `test:0:${opts.username}`,
    },
  });
  return user.id;
}

/**
 * Open a supertest agent authenticated as the given email/role.
 */
async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'student',
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role });
  return agent;
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

// ---------------------------------------------------------------------------
// Unauthenticated
// ---------------------------------------------------------------------------

describe('PATCH /api/account/credentials — unauthenticated', () => {
  it('returns 401 with no session', async () => {
    const res = await request(app)
      .patch('/api/account/credentials')
      .send({ currentPassword: 'secret', newPassword: 'newpass' });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Happy path — change password only
// ---------------------------------------------------------------------------

describe('PATCH /api/account/credentials — change password', () => {
  it('returns 200 with { id, username }, hash updated, no password_hash in body', async () => {
    const userId = await makePassphraseUser({
      email: 'cred-pwonly@example.com',
      username: 'credpwonly',
      password: 'original-password',
    });
    const agent = await loginAs('cred-pwonly@example.com', 'student');

    const res = await agent.patch('/api/account/credentials').send({
      currentPassword: 'original-password',
      newPassword: 'brand-new-password',
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', userId);
    expect(res.body).toHaveProperty('username', 'credpwonly');
    expect(res.body).not.toHaveProperty('password_hash');

    // Verify new password is persisted.
    const updated = await (prisma as any).user.findUnique({ where: { id: userId } });
    const valid = await verifyPassword('brand-new-password', updated.password_hash);
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Happy path — change username only
// ---------------------------------------------------------------------------

describe('PATCH /api/account/credentials — change username', () => {
  it('returns 200 with new username, persisted in DB', async () => {
    const userId = await makePassphraseUser({
      email: 'cred-uname@example.com',
      username: 'olduname',
      password: 'mypassword',
    });
    const agent = await loginAs('cred-uname@example.com', 'student');

    const res = await agent.patch('/api/account/credentials').send({
      currentPassword: 'mypassword',
      username: 'newuname',
    });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('newuname');

    const updated = await (prisma as any).user.findUnique({ where: { id: userId } });
    expect(updated.username).toBe('newuname');
    expect(res.body).not.toHaveProperty('password_hash');
  });
});

// ---------------------------------------------------------------------------
// Happy path — change both username and password
// ---------------------------------------------------------------------------

describe('PATCH /api/account/credentials — change both', () => {
  it('returns 200, persists both changes', async () => {
    const userId = await makePassphraseUser({
      email: 'cred-both@example.com',
      username: 'userboth',
      password: 'pass-both',
    });
    const agent = await loginAs('cred-both@example.com', 'student');

    const res = await agent.patch('/api/account/credentials').send({
      currentPassword: 'pass-both',
      username: 'userboth2',
      newPassword: 'pass-both-new',
    });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('userboth2');
    expect(res.body).not.toHaveProperty('password_hash');

    const updated = await (prisma as any).user.findUnique({ where: { id: userId } });
    expect(updated.username).toBe('userboth2');
    const valid = await verifyPassword('pass-both-new', updated.password_hash);
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wrong currentPassword → 401
// ---------------------------------------------------------------------------

describe('PATCH /api/account/credentials — wrong currentPassword', () => {
  it('returns 401 and does not change anything', async () => {
    const userId = await makePassphraseUser({
      email: 'cred-wrongpw@example.com',
      username: 'credwrong',
      password: 'correct-password',
    });
    const agent = await loginAs('cred-wrongpw@example.com', 'student');

    const before = await (prisma as any).user.findUnique({ where: { id: userId } });

    const res = await agent.patch('/api/account/credentials').send({
      currentPassword: 'wrong-password',
      newPassword: 'new-password',
    });

    expect(res.status).toBe(401);

    // DB unchanged.
    const after = await (prisma as any).user.findUnique({ where: { id: userId } });
    expect(after.password_hash).toBe(before.password_hash);
    expect(after.username).toBe(before.username);
  });
});

// ---------------------------------------------------------------------------
// Username collision → 409
// ---------------------------------------------------------------------------

describe('PATCH /api/account/credentials — username collision', () => {
  it('returns 409 when target username is already taken', async () => {
    // Create two users; second tries to claim first's username.
    await makePassphraseUser({
      email: 'cred-taken@example.com',
      username: 'takenuser',
      password: 'pw-taken',
    });
    await makePassphraseUser({
      email: 'cred-claimer@example.com',
      username: 'claimer',
      password: 'pw-claimer',
    });
    const agent = await loginAs('cred-claimer@example.com', 'student');

    const res = await agent.patch('/api/account/credentials').send({
      currentPassword: 'pw-claimer',
      username: 'takenuser',
    });

    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Empty body / no field besides currentPassword → 400
// ---------------------------------------------------------------------------

describe('PATCH /api/account/credentials — empty patch', () => {
  it('returns 400 when no username or newPassword provided', async () => {
    await makePassphraseUser({
      email: 'cred-empty@example.com',
      username: 'emptyuser',
      password: 'mypass',
    });
    const agent = await loginAs('cred-empty@example.com', 'student');

    const res = await agent
      .patch('/api/account/credentials')
      .send({ currentPassword: 'mypass' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when body has no currentPassword', async () => {
    await makePassphraseUser({
      email: 'cred-nocurr@example.com',
      username: 'nocurruser',
      password: 'mypass',
    });
    const agent = await loginAs('cred-nocurr@example.com', 'student');

    const res = await agent
      .patch('/api/account/credentials')
      .send({ newPassword: 'newpass' });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Empty-string newPassword → 400
// ---------------------------------------------------------------------------

describe('PATCH /api/account/credentials — empty newPassword', () => {
  it('returns 400 for empty-string newPassword', async () => {
    await makePassphraseUser({
      email: 'cred-emptypass@example.com',
      username: 'emptypassuser',
      password: 'mypass',
    });
    const agent = await loginAs('cred-emptypass@example.com', 'student');

    const res = await agent.patch('/api/account/credentials').send({
      currentPassword: 'mypass',
      newPassword: '',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for whitespace-only newPassword', async () => {
    await makePassphraseUser({
      email: 'cred-wspass@example.com',
      username: 'wspassuser',
      password: 'mypass',
    });
    const agent = await loginAs('cred-wspass@example.com', 'student');

    const res = await agent.patch('/api/account/credentials').send({
      currentPassword: 'mypass',
      newPassword: '   ',
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Audit event written on success
// ---------------------------------------------------------------------------

describe('PATCH /api/account/credentials — audit event', () => {
  it('writes account_credentials_updated audit event on success', async () => {
    const userId = await makePassphraseUser({
      email: 'cred-audit@example.com',
      username: 'audituser',
      password: 'auditpass',
    });
    const agent = await loginAs('cred-audit@example.com', 'student');

    await agent.patch('/api/account/credentials').send({
      currentPassword: 'auditpass',
      newPassword: 'auditpass-new',
    });

    const event = await (prisma as any).auditEvent.findFirst({
      where: { action: 'account_credentials_updated', actor_user_id: userId },
    });
    expect(event).not.toBeNull();
    expect((event.details as any).updated_password).toBe(true);
    expect((event.details as any).updated_username).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Response never leaks password_hash
// ---------------------------------------------------------------------------

describe('PATCH /api/account/credentials — response shape', () => {
  it('never includes password_hash in response body', async () => {
    await makePassphraseUser({
      email: 'cred-shape@example.com',
      username: 'shapeuser',
      password: 'shapepass',
    });
    const agent = await loginAs('cred-shape@example.com', 'student');

    const res = await agent.patch('/api/account/credentials').send({
      currentPassword: 'shapepass',
      newPassword: 'shapepass-new',
    });

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('password_hash');
    expect(Object.keys(body)).toEqual(expect.arrayContaining(['id', 'username']));
  });
});
