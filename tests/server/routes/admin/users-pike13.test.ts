/**
 * Tests for GET /api/admin/users/:id/pike13 (Sprint 009 T002).
 *
 * Covers:
 *  - 401 when not authenticated
 *  - 403 when authenticated as non-admin
 *  - 404 when the user does not exist
 *  - { present: false } when the user has no Pike13 ExternalAccount
 *  - { present: true, person } when Pike13 succeeds
 *  - { present: true, error } when the Pike13 API call fails (fail-soft)
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { FakePike13ApiClient } from '../../helpers/fake-pike13-api.client.js';
import { Pike13ApiError } from '../../../../server/src/services/pike13/pike13-api.client.js';

process.env.NODE_ENV = 'test';

import app, { registry } from '../../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'admin',
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role });
  return agent;
}

async function createUserWithPike13Account(
  email: string,
  pike13ExternalId: string,
): Promise<number> {
  const user = await (prisma as any).user.create({
    data: {
      primary_email: email,
      display_name: 'Test User',
      role: 'student',
      created_via: 'admin_created',
    },
  });
  await (prisma as any).externalAccount.create({
    data: {
      user_id: user.id,
      type: 'pike13',
      status: 'active',
      external_id: pike13ExternalId,
    },
  });
  return user.id;
}

async function createUserWithoutPike13Account(email: string): Promise<number> {
  const user = await (prisma as any).user.create({
    data: {
      primary_email: email,
      display_name: 'No Pike13 User',
      role: 'student',
      created_via: 'admin_created',
    },
  });
  return user.id;
}

// ---------------------------------------------------------------------------
// Test setup: inject FakePike13ApiClient into the registry for all tests
// ---------------------------------------------------------------------------

let fakePike13: FakePike13ApiClient;

beforeAll(() => {
  fakePike13 = new FakePike13ApiClient();
  (registry as any).pike13Client = fakePike13;
});

beforeEach(async () => {
  await cleanDb();
  fakePike13.reset();
});

// ---------------------------------------------------------------------------
// Auth enforcement
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id/pike13 — auth enforcement', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/admin/users/999/pike13');
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated as student (non-admin)', async () => {
    const agent = await loginAs('student@example.com', 'student');
    const res = await agent.get('/api/admin/users/999/pike13');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Not found
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id/pike13 — user not found', () => {
  it('returns 404 when the user does not exist', async () => {
    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.get('/api/admin/users/999999/pike13');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'User not found' });
  });
});

// ---------------------------------------------------------------------------
// present: false — no Pike13 account
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id/pike13 — no Pike13 account', () => {
  it('returns { present: false } when the user has no Pike13 ExternalAccount', async () => {
    const userId = await createUserWithoutPike13Account('nopike13@example.com');
    const agent = await loginAs('admin2@example.com', 'admin');
    const res = await agent.get(`/api/admin/users/${userId}/pike13`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ present: false });
  });
});

// ---------------------------------------------------------------------------
// present: true, person — Pike13 API success
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id/pike13 — Pike13 success', () => {
  it('returns { present: true, person } when Pike13 returns the person', async () => {
    const userId = await createUserWithPike13Account('withpike13@example.com', '42');

    fakePike13.configure('getPerson', {
      id: 42,
      first_name: 'Alice',
      last_name: 'Walker',
      email: 'alice@pike13.example.com',
    });

    const agent = await loginAs('admin3@example.com', 'admin');
    const res = await agent.get(`/api/admin/users/${userId}/pike13`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      present: true,
      person: {
        id: 42,
        first_name: 'Alice',
        last_name: 'Walker',
        email: 'alice@pike13.example.com',
      },
    });
    expect(fakePike13.calls.getPerson).toContain(42);
  });
});

// ---------------------------------------------------------------------------
// present: true, error — Pike13 API failure (fail-soft)
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id/pike13 — Pike13 API error (fail-soft)', () => {
  it('returns { present: true, error } without throwing 500 when Pike13 API fails', async () => {
    const userId = await createUserWithPike13Account('errorpike13@example.com', '99');

    fakePike13.configureError(
      'getPerson',
      new Pike13ApiError('Pike13 API error 503 (getPerson)', 'getPerson', 503),
    );

    const agent = await loginAs('admin4@example.com', 'admin');
    const res = await agent.get(`/api/admin/users/${userId}/pike13`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      present: true,
      error: expect.stringContaining('Pike13'),
    });
  });

  it('returns { present: true, error } when Pike13 throws a network error', async () => {
    const userId = await createUserWithPike13Account('networkerr@example.com', '77');

    fakePike13.configureError(
      'getPerson',
      new Error('fetch failed: ECONNREFUSED'),
    );

    const agent = await loginAs('admin5@example.com', 'admin');
    const res = await agent.get(`/api/admin/users/${userId}/pike13`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      present: true,
      error: 'fetch failed: ECONNREFUSED',
    });
  });
});
