/**
 * Integration tests for POST /api/auth/passphrase-signup (Sprint 015 T005).
 *
 * Public endpoint — no auth required. Students self-register using a
 * time-limited passphrase tied to a Group or Cohort scope.
 *
 * Uses the real SQLite test database via the shared Prisma client.
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeCohort, makeGroup, makeUser } from '../helpers/factories.js';

process.env.NODE_ENV = 'test';
process.env.GOOGLE_STUDENT_DOMAIN = 'students.jointheleague.org';

import app from '../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  // Clear passphrase fields (columns, not rows).
  await (prisma as any).cohort.updateMany({
    data: {
      signup_passphrase: null,
      signup_passphrase_grant_llm_proxy: false,
      signup_passphrase_expires_at: null,
      signup_passphrase_created_at: null,
      signup_passphrase_created_by: null,
    },
  });
  await (prisma as any).group.updateMany({
    data: {
      signup_passphrase: null,
      signup_passphrase_grant_llm_proxy: false,
      signup_passphrase_expires_at: null,
      signup_passphrase_created_at: null,
      signup_passphrase_created_by: null,
    },
  });
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

/**
 * Set a passphrase on a cohort row directly (bypasses service TTL).
 */
async function setCohortPassphrase(
  cohortId: number,
  passphrase: string,
  grantLlmProxy = false,
  expiresOffset = PassphraseService.TTL_MS,
): Promise<void> {
  const now = new Date();
  await (prisma as any).cohort.update({
    where: { id: cohortId },
    data: {
      signup_passphrase: passphrase,
      signup_passphrase_grant_llm_proxy: grantLlmProxy,
      signup_passphrase_expires_at: new Date(now.getTime() + expiresOffset),
      signup_passphrase_created_at: now,
      signup_passphrase_created_by: 1,
    },
  });
}

/**
 * Set a passphrase on a group row directly.
 */
async function setGroupPassphrase(
  groupId: number,
  passphrase: string,
  grantLlmProxy = false,
  expiresOffset = PassphraseService.TTL_MS,
): Promise<void> {
  const now = new Date();
  await (prisma as any).group.update({
    where: { id: groupId },
    data: {
      signup_passphrase: passphrase,
      signup_passphrase_grant_llm_proxy: grantLlmProxy,
      signup_passphrase_expires_at: new Date(now.getTime() + expiresOffset),
      signup_passphrase_created_at: now,
      signup_passphrase_created_by: 1,
    },
  });
}

// We import the TTL constant directly to avoid magic numbers in the helpers.
import { PassphraseService } from '../../../server/src/services/passphrase.service.js';

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
// Happy path — cohort scope
// ===========================================================================

describe('POST /api/auth/passphrase-signup — cohort happy path', () => {
  it('creates user + login, sets session, returns 200 with correct fields', async () => {
    const cohort = await makeCohort({ name: 'Cohort Happy' });
    await setCohortPassphrase(cohort.id, 'word-test-blue');

    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/passphrase-signup')
      .send({ username: 'alice', passphrase: 'word-test-blue' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.username).toBe('alice');
    expect(res.body.displayName).toBe('alice');
    expect(res.body.primaryEmail).toMatch(/^alice@students\.jointheleague\.org$/);
    expect(res.body.cohort).toEqual({ id: cohort.id });

    // Verify user row
    const user = await (prisma as any).user.findUnique({ where: { username: 'alice' } });
    expect(user).toBeDefined();
    expect(user.password_hash).toBeTruthy();
    expect(user.cohort_id).toBe(cohort.id);
    expect(user.created_via).toBe('passphrase_signup');

    // Verify login row
    const login = await (prisma as any).login.findFirst({ where: { user_id: user.id, provider: 'passphrase' } });
    expect(login).toBeDefined();
    expect(login.provider_user_id).toBe(`cohort:${cohort.id}:alice`);

    // Verify session — GET /api/auth/me should return the user
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.id).toBe(res.body.id);
  });
});

// ===========================================================================
// Happy path — cohort scope with grantLlmProxy=true
// ===========================================================================

describe('POST /api/auth/passphrase-signup — cohort + grantLlmProxy=true', () => {
  it('grants LLM proxy token, response.llmProxy.granted === true', async () => {
    const cohort = await makeCohort({ name: 'Cohort LLM' });
    await setCohortPassphrase(cohort.id, 'llm-test-phrase', true);

    const res = await request(app)
      .post('/api/auth/passphrase-signup')
      .send({ username: 'bob', passphrase: 'llm-test-phrase' });

    expect(res.status).toBe(200);
    expect(res.body.llmProxy?.granted).toBe(true);

    // Verify an active LLM proxy token row exists for the user
    const user = await (prisma as any).user.findUnique({ where: { username: 'bob' } });
    expect(user).toBeDefined();
    const token = await (prisma as any).llmProxyToken.findFirst({
      where: { user_id: user.id, revoked_at: null },
    });
    expect(token).toBeDefined();
    expect(token.token_limit).toBe(1_000_000);
  });
});

// ===========================================================================
// Happy path — group scope
// ===========================================================================

describe('POST /api/auth/passphrase-signup — group happy path', () => {
  it('creates user, adds to group, no workspace ExternalAccount', async () => {
    const group = await makeGroup({ name: 'Test Group Happy' });
    await setGroupPassphrase(group.id, 'group-join-phrase');

    const res = await request(app)
      .post('/api/auth/passphrase-signup')
      .send({ username: 'charlie', passphrase: 'group-join-phrase' });

    expect(res.status).toBe(200);
    expect(res.body.cohort).toBeNull();
    expect(res.body.workspace).toBeUndefined();

    // Verify user created
    const user = await (prisma as any).user.findUnique({ where: { username: 'charlie' } });
    expect(user).toBeDefined();

    // Verify group membership
    const membership = await (prisma as any).userGroup.findFirst({
      where: { group_id: group.id, user_id: user.id },
    });
    expect(membership).toBeDefined();

    // No workspace ExternalAccount
    const extAcct = await (prisma as any).externalAccount.findFirst({
      where: { user_id: user.id, type: 'workspace' },
    });
    expect(extAcct).toBeNull();
  });
});

// ===========================================================================
// Cohort — workspace provisioning failure is fail-soft
// ===========================================================================

describe('POST /api/auth/passphrase-signup — workspace provisioning fail-soft', () => {
  it('user is created and logged in even when workspace provisioning throws', async () => {
    // No Google credentials are set, so workspace.provision will throw.
    // We unset them to be sure.
    const origJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const origEmail = process.env.GOOGLE_ADMIN_DELEGATED_USER_EMAIL;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_ADMIN_DELEGATED_USER_EMAIL;

    try {
      const cohort = await makeCohort({ name: 'Cohort ProvFail', google_ou_path: '/Test/OU' });
      await setCohortPassphrase(cohort.id, 'workspace-fail-phrase');

      const agent = request.agent(app);
      const res = await agent
        .post('/api/auth/passphrase-signup')
        .send({ username: 'daisy', passphrase: 'workspace-fail-phrase' });

      expect(res.status).toBe(200);
      expect(res.body.workspace.provisioned).toBe(false);
      expect(typeof res.body.workspace.error).toBe('string');

      // User is still created
      const user = await (prisma as any).user.findUnique({ where: { username: 'daisy' } });
      expect(user).toBeDefined();

      // Session is set
      const meRes = await agent.get('/api/auth/me');
      expect(meRes.status).toBe(200);
      expect(meRes.body.id).toBe(res.body.id);
    } finally {
      if (origJson !== undefined) process.env.GOOGLE_SERVICE_ACCOUNT_JSON = origJson;
      if (origEmail !== undefined) process.env.GOOGLE_ADMIN_DELEGATED_USER_EMAIL = origEmail;
    }
  });
});

// ===========================================================================
// Wrong passphrase → 401
// ===========================================================================

describe('POST /api/auth/passphrase-signup — wrong passphrase', () => {
  it('returns 401 and does not create a user', async () => {
    const res = await request(app)
      .post('/api/auth/passphrase-signup')
      .send({ username: 'eve', passphrase: 'totally-wrong-phrase' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid|expired/i);

    const user = await (prisma as any).user.findUnique({ where: { username: 'eve' } });
    expect(user).toBeNull();
  });
});

// ===========================================================================
// Expired passphrase → 401
// ===========================================================================

describe('POST /api/auth/passphrase-signup — expired passphrase', () => {
  it('returns 401 after passphrase expires', async () => {
    const cohort = await makeCohort({ name: 'Expired Cohort' });
    // Set expiry in the past
    await setCohortPassphrase(cohort.id, 'expired-phrase', false, -1000);

    const res = await request(app)
      .post('/api/auth/passphrase-signup')
      .send({ username: 'frank', passphrase: 'expired-phrase' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid|expired/i);

    const user = await (prisma as any).user.findUnique({ where: { username: 'frank' } });
    expect(user).toBeNull();
  });
});

// ===========================================================================
// Bad username shape → 400
// ===========================================================================

describe('POST /api/auth/passphrase-signup — invalid username format', () => {
  it('returns 400 for username with spaces', async () => {
    const cohort = await makeCohort({ name: 'Shape Cohort 1' });
    await setCohortPassphrase(cohort.id, 'shape-test-one');

    const res = await request(app)
      .post('/api/auth/passphrase-signup')
      .send({ username: 'hello world', passphrase: 'shape-test-one' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for username with special characters', async () => {
    const cohort = await makeCohort({ name: 'Shape Cohort 2' });
    await setCohortPassphrase(cohort.id, 'shape-test-two');

    const res = await request(app)
      .post('/api/auth/passphrase-signup')
      .send({ username: 'alice!@#', passphrase: 'shape-test-two' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for username shorter than 2 chars', async () => {
    const cohort = await makeCohort({ name: 'Shape Cohort 3' });
    await setCohortPassphrase(cohort.id, 'shape-test-three');

    const res = await request(app)
      .post('/api/auth/passphrase-signup')
      .send({ username: 'a', passphrase: 'shape-test-three' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for username longer than 32 chars', async () => {
    const cohort = await makeCohort({ name: 'Shape Cohort 4' });
    await setCohortPassphrase(cohort.id, 'shape-test-four');

    const res = await request(app)
      .post('/api/auth/passphrase-signup')
      .send({ username: 'a'.repeat(33), passphrase: 'shape-test-four' });

    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// Username collision → 409
// ===========================================================================

describe('POST /api/auth/passphrase-signup — username collision', () => {
  it('returns 409 if username is already taken', async () => {
    // Pre-create a user with username 'alice'
    await (prisma as any).user.create({
      data: {
        display_name: 'Alice',
        primary_email: 'alice.existing@example.com',
        username: 'alice',
        role: 'student',
        created_via: 'admin_created',
      },
    });

    const cohort = await makeCohort({ name: 'Collision Cohort' });
    await setCohortPassphrase(cohort.id, 'collision-phrase');

    const res = await request(app)
      .post('/api/auth/passphrase-signup')
      .send({ username: 'alice', passphrase: 'collision-phrase' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already taken/i);
  });
});

// ===========================================================================
// Missing fields → 400
// ===========================================================================

describe('POST /api/auth/passphrase-signup — missing fields', () => {
  it('returns 400 for empty body', async () => {
    const res = await request(app)
      .post('/api/auth/passphrase-signup')
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 400 when username is missing', async () => {
    const res = await request(app)
      .post('/api/auth/passphrase-signup')
      .send({ passphrase: 'some-phrase' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when passphrase is missing', async () => {
    const res = await request(app)
      .post('/api/auth/passphrase-signup')
      .send({ username: 'alice' });

    expect(res.status).toBe(400);
  });
});
