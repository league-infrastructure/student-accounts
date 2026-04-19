/**
 * Integration tests for GET /api/account (T002).
 *
 * Covers:
 *  1. Authenticated student with full data — 200 with correct AccountData shape.
 *  2. Unauthenticated request — 401.
 *  3. Authenticated staff user — 403.
 *  4. Authenticated admin user — 403.
 *  5. Student with no cohort — profile.cohort is null.
 *  6. Student with no external accounts or provisioning requests — empty arrays.
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import {
  makeCohort,
  makeUser,
  makeLogin,
  makeExternalAccount,
  makeProvisioningRequest,
} from '../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app from '../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

/**
 * Create a supertest agent and log in as the given user via test-login.
 * If displayName is provided it is forwarded to the test-login endpoint so
 * the upsert uses that value instead of falling back to the email address.
 */
async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'student',
  displayName?: string,
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role, displayName });
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
// Test 1: Full payload for authenticated student
// ---------------------------------------------------------------------------

describe('GET /api/account — authenticated student with full data', () => {
  it('returns 200 with correct AccountData shape', async () => {
    const cohort = await makeCohort({ name: 'Spring 2025' });
    const user = await makeUser({
      primary_email: 'student-full@example.com',
      display_name: 'Full Student',
      role: 'student',
      cohort_id: cohort.id,
    });
    const login = await makeLogin(user, {
      provider: 'google',
      provider_email: 'student-full@gmail.com',
    });
    const account = await makeExternalAccount(user, { type: 'workspace', status: 'pending' });
    const prReq = await makeProvisioningRequest(user, {
      requested_type: 'workspace',
      status: 'pending',
    });

    const agent = await loginAs('student-full@example.com', 'student', 'Full Student');
    const res = await agent.get('/api/account');

    expect(res.status).toBe(200);

    // profile
    expect(res.body.profile).toMatchObject({
      id: user.id,
      displayName: 'Full Student',
      primaryEmail: 'student-full@example.com',
      cohort: { id: cohort.id, name: 'Spring 2025' },
      role: 'student',
    });
    expect(res.body.profile.createdAt).toBeDefined();

    // logins
    expect(Array.isArray(res.body.logins)).toBe(true);
    expect(res.body.logins).toHaveLength(1);
    expect(res.body.logins[0]).toMatchObject({
      id: login.id,
      provider: 'google',
      providerEmail: 'student-full@gmail.com',
    });
    expect(res.body.logins[0].createdAt).toBeDefined();

    // externalAccounts
    expect(Array.isArray(res.body.externalAccounts)).toBe(true);
    expect(res.body.externalAccounts).toHaveLength(1);
    expect(res.body.externalAccounts[0]).toMatchObject({
      id: account.id,
      type: 'workspace',
      status: 'pending',
    });
    expect(res.body.externalAccounts[0].createdAt).toBeDefined();

    // provisioningRequests
    expect(Array.isArray(res.body.provisioningRequests)).toBe(true);
    expect(res.body.provisioningRequests).toHaveLength(1);
    expect(res.body.provisioningRequests[0]).toMatchObject({
      id: prReq.id,
      requestedType: 'workspace',
      status: 'pending',
      decidedAt: null,
    });
    expect(res.body.provisioningRequests[0].createdAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 2: Unauthenticated request — 401
// ---------------------------------------------------------------------------

describe('GET /api/account — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).get('/api/account');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Staff user — 403
// ---------------------------------------------------------------------------

describe('GET /api/account — staff user', () => {
  it('returns 403 for a user with role=staff', async () => {
    await makeUser({ primary_email: 'staff-user@example.com', role: 'staff' });
    const agent = await loginAs('staff-user@example.com', 'staff');
    const res = await agent.get('/api/account');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Admin user — 403
// ---------------------------------------------------------------------------

describe('GET /api/account — admin user', () => {
  it('returns 403 for a user with role=admin', async () => {
    await makeUser({ primary_email: 'admin-user@example.com', role: 'admin' });
    const agent = await loginAs('admin-user@example.com', 'admin');
    const res = await agent.get('/api/account');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Student with no cohort — profile.cohort is null
// ---------------------------------------------------------------------------

describe('GET /api/account — student with no cohort', () => {
  it('returns profile.cohort as null when student has no cohort assignment', async () => {
    const user = await makeUser({
      primary_email: 'nocohort@example.com',
      role: 'student',
      cohort_id: null,
    });
    await makeLogin(user);

    const agent = await loginAs('nocohort@example.com', 'student');
    const res = await agent.get('/api/account');

    expect(res.status).toBe(200);
    expect(res.body.profile.cohort).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 6: Student with no external accounts or provisioning requests — empty arrays
// ---------------------------------------------------------------------------

describe('GET /api/account — student with no external accounts or requests', () => {
  it('returns empty arrays (not omitted) for externalAccounts and provisioningRequests', async () => {
    const user = await makeUser({
      primary_email: 'empty-arrays@example.com',
      role: 'student',
    });
    await makeLogin(user);

    const agent = await loginAs('empty-arrays@example.com', 'student');
    const res = await agent.get('/api/account');

    expect(res.status).toBe(200);
    expect(res.body.externalAccounts).toEqual([]);
    expect(res.body.provisioningRequests).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Data is scoped to req.session.userId only
// ---------------------------------------------------------------------------

describe('GET /api/account — data scoping', () => {
  it('returns data for the signed-in user only, not other users', async () => {
    // Create two distinct users
    const userA = await makeUser({ primary_email: 'scope-a@example.com', role: 'student' });
    const userB = await makeUser({ primary_email: 'scope-b@example.com', role: 'student' });

    await makeLogin(userA, { provider: 'google', provider_email: 'scope-a@gmail.com' });
    await makeLogin(userB, { provider: 'github', provider_email: 'scope-b@github.com' });
    await makeExternalAccount(userB, { type: 'workspace', status: 'active' });

    // Log in as userA
    const agent = await loginAs('scope-a@example.com', 'student');
    const res = await agent.get('/api/account');

    expect(res.status).toBe(200);
    // userA has exactly one login (google), no external accounts
    expect(res.body.logins).toHaveLength(1);
    expect(res.body.logins[0].provider).toBe('google');
    expect(res.body.externalAccounts).toEqual([]);
    // profile must be userA's
    expect(res.body.profile.primaryEmail).toBe('scope-a@example.com');
    expect(res.body.profile.id).toBe(userA.id);
  });
});
