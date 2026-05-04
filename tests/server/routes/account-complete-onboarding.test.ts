/**
 * Integration tests for POST /api/account/complete-onboarding (Sprint 028 T012).
 *
 * Verifies:
 *   - displayName is required and validated (existing behaviour)
 *   - email is optional; when provided it is persisted as lowercase
 *   - invalid email shape is rejected with 400
 *   - missing email is fine (only displayName + onboarding flag updated)
 *   - unauthenticated requests are rejected with 401
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../../server/src/app.js';
import { prisma } from '../../../server/src/services/prisma.js';

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
  await (prisma as any).cohort.deleteMany();
}

beforeEach(async () => {
  await cleanDb();
});

afterEach(async () => {
  await cleanDb();
});

/**
 * Open a supertest agent authenticated as a student via the test-login
 * endpoint and return both the agent and the created user id.
 */
async function loginAsStudent(email: string): Promise<{
  agent: ReturnType<typeof request.agent>;
  userId: number;
}> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/test-login')
    .send({ email, displayName: 'Test Student', role: 'student' })
    .expect(200);
  const userId = res.body.id as number;
  return { agent, userId };
}

// ---------------------------------------------------------------------------
// POST /api/account/complete-onboarding — unauthenticated
// ---------------------------------------------------------------------------

describe('POST /api/account/complete-onboarding — unauthenticated', () => {
  it('returns 401 with no session', async () => {
    const res = await request(app)
      .post('/api/account/complete-onboarding')
      .send({ displayName: 'Alice' });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/account/complete-onboarding — displayName validation (existing)
// ---------------------------------------------------------------------------

describe('POST /api/account/complete-onboarding — displayName validation', () => {
  it('returns 400 when displayName is missing', async () => {
    const { agent } = await loginAsStudent('dn-missing@example.com');
    const res = await agent
      .post('/api/account/complete-onboarding')
      .send({ email: 'valid@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/displayName/);
  });

  it('returns 400 when displayName is empty string', async () => {
    const { agent } = await loginAsStudent('dn-empty@example.com');
    const res = await agent
      .post('/api/account/complete-onboarding')
      .send({ displayName: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when displayName exceeds 120 characters', async () => {
    const { agent } = await loginAsStudent('dn-long@example.com');
    const res = await agent
      .post('/api/account/complete-onboarding')
      .send({ displayName: 'a'.repeat(121) });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/account/complete-onboarding — email accepted and persisted
// ---------------------------------------------------------------------------

describe('POST /api/account/complete-onboarding — email field', () => {
  it('persists displayName and sets onboarding_completed when email is omitted', async () => {
    const { agent, userId } = await loginAsStudent('no-email@example.com');
    const res = await agent
      .post('/api/account/complete-onboarding')
      .send({ displayName: 'Alice Smith' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const user = await (prisma as any).user.findUnique({ where: { id: userId } });
    expect(user.display_name).toBe('Alice Smith');
    expect(user.onboarding_completed).toBe(true);
    // primary_email unchanged from what test-login set
    expect(user.primary_email).toBe('no-email@example.com');
  });

  it('persists email when provided alongside displayName', async () => {
    const { agent, userId } = await loginAsStudent('old-email@example.com');
    const res = await agent
      .post('/api/account/complete-onboarding')
      .send({ displayName: 'Bob Jones', email: 'bob@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const user = await (prisma as any).user.findUnique({ where: { id: userId } });
    expect(user.display_name).toBe('Bob Jones');
    expect(user.onboarding_completed).toBe(true);
    expect(user.primary_email).toBe('bob@example.com');
  });

  it('normalizes email to lowercase before persisting', async () => {
    const { agent, userId } = await loginAsStudent('mixed-case@example.com');
    const res = await agent
      .post('/api/account/complete-onboarding')
      .send({ displayName: 'Carol', email: 'Carol.Smith@EXAMPLE.COM' });
    expect(res.status).toBe(200);

    const user = await (prisma as any).user.findUnique({ where: { id: userId } });
    expect(user.primary_email).toBe('carol.smith@example.com');
  });

  it('trims whitespace from email before persisting', async () => {
    const { agent, userId } = await loginAsStudent('trim-email@example.com');
    const res = await agent
      .post('/api/account/complete-onboarding')
      .send({ displayName: 'Dave', email: '  dave@example.com  ' });
    expect(res.status).toBe(200);

    const user = await (prisma as any).user.findUnique({ where: { id: userId } });
    expect(user.primary_email).toBe('dave@example.com');
  });
});

// ---------------------------------------------------------------------------
// POST /api/account/complete-onboarding — invalid email → 400
// ---------------------------------------------------------------------------

describe('POST /api/account/complete-onboarding — invalid email', () => {
  it('returns 400 when email is an empty string', async () => {
    const { agent } = await loginAsStudent('empty-email@example.com');
    const res = await agent
      .post('/api/account/complete-onboarding')
      .send({ displayName: 'Eve', email: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/);
  });

  it('returns 400 when email has no @ symbol', async () => {
    const { agent } = await loginAsStudent('no-at@example.com');
    const res = await agent
      .post('/api/account/complete-onboarding')
      .send({ displayName: 'Frank', email: 'notanemail' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/);
  });

  it('returns 400 when email has no dot after @', async () => {
    const { agent } = await loginAsStudent('no-dot@example.com');
    const res = await agent
      .post('/api/account/complete-onboarding')
      .send({ displayName: 'Grace', email: 'grace@nodot' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/);
  });

  it('returns 400 when email starts with @', async () => {
    const { agent } = await loginAsStudent('starts-at@example.com');
    const res = await agent
      .post('/api/account/complete-onboarding')
      .send({ displayName: 'Hank', email: '@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/);
  });

  it('returns 400 when email is a non-string type', async () => {
    const { agent } = await loginAsStudent('nonstring-email@example.com');
    const res = await agent
      .post('/api/account/complete-onboarding')
      .send({ displayName: 'Iris', email: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/);
  });
});
