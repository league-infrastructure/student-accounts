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
// DELETE /api/account/logins/:id tests (T003)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test: Happy path — removes login and returns 204
// ---------------------------------------------------------------------------

describe('DELETE /api/account/logins/:id — happy path', () => {
  it('returns 204 when login belongs to current user and another login remains', async () => {
    const user = await makeUser({ primary_email: 'del-happy@example.com', role: 'student' });
    const login1 = await makeLogin(user, { provider: 'google' });
    const login2 = await makeLogin(user, { provider: 'github' });

    const agent = await loginAs('del-happy@example.com', 'student');
    const res = await agent.delete(`/api/account/logins/${login2.id}`);

    expect(res.status).toBe(204);

    // Confirm login2 is gone from the database
    const remaining = await (prisma as any).login.findMany({ where: { user_id: user.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(login1.id);
  });

  it('records a remove_login audit event atomically with the deletion', async () => {
    const user = await makeUser({ primary_email: 'del-audit@example.com', role: 'student' });
    const login1 = await makeLogin(user, { provider: 'google' });
    const login2 = await makeLogin(user, { provider: 'github' });

    const agent = await loginAs('del-audit@example.com', 'student');
    await agent.delete(`/api/account/logins/${login2.id}`);

    const auditRows = await (prisma as any).auditEvent.findMany({
      where: { action: 'remove_login', target_user_id: user.id },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].target_entity_id).toBe(String(login2.id));
    expect(auditRows[0].details).toMatchObject({ provider: 'github' });
  });
});

// ---------------------------------------------------------------------------
// Test: Last-login guard — 409
// ---------------------------------------------------------------------------

describe('DELETE /api/account/logins/:id — last-login guard', () => {
  it('returns 409 when the user has exactly one login', async () => {
    const user = await makeUser({ primary_email: 'del-last@example.com', role: 'student' });
    const login = await makeLogin(user, { provider: 'google' });

    const agent = await loginAs('del-last@example.com', 'student');
    const res = await agent.delete(`/api/account/logins/${login.id}`);

    expect(res.status).toBe(409);

    // Login must still exist
    const remaining = await (prisma as any).login.findMany({ where: { user_id: user.id } });
    expect(remaining).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test: Cross-user attempt — 404
// ---------------------------------------------------------------------------

describe('DELETE /api/account/logins/:id — cross-user scope guard', () => {
  it('returns 404 when login belongs to another user', async () => {
    const userA = await makeUser({ primary_email: 'del-scope-a@example.com', role: 'student' });
    const userB = await makeUser({ primary_email: 'del-scope-b@example.com', role: 'student' });
    await makeLogin(userA, { provider: 'google' });
    const loginB1 = await makeLogin(userB, { provider: 'google' });
    await makeLogin(userB, { provider: 'github' });

    // Log in as userA and try to delete userB's login
    const agent = await loginAs('del-scope-a@example.com', 'student');
    const res = await agent.delete(`/api/account/logins/${loginB1.id}`);

    expect(res.status).toBe(404);

    // userB's login must still exist
    const remaining = await (prisma as any).login.findMany({ where: { user_id: userB.id } });
    expect(remaining.some((l: any) => l.id === loginB1.id)).toBe(true);
  });

  it('returns 404 for a non-existent login id', async () => {
    const user = await makeUser({ primary_email: 'del-nonexist@example.com', role: 'student' });
    await makeLogin(user, { provider: 'google' });

    const agent = await loginAs('del-nonexist@example.com', 'student');
    const res = await agent.delete('/api/account/logins/9999999');

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Test: Unauthenticated — 401
// ---------------------------------------------------------------------------

describe('DELETE /api/account/logins/:id — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).delete('/api/account/logins/1');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Test: Staff role — 403
// ---------------------------------------------------------------------------

describe('DELETE /api/account/logins/:id — staff role', () => {
  it('returns 403 for a user with role=staff', async () => {
    const user = await makeUser({ primary_email: 'del-staff@example.com', role: 'staff' });
    const login = await makeLogin(user, { provider: 'google' });

    const agent = await loginAs('del-staff@example.com', 'staff');
    const res = await agent.delete(`/api/account/logins/${login.id}`);

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Test: Session remains valid after removing the login used to sign in
// ---------------------------------------------------------------------------

describe('DELETE /api/account/logins/:id — session survives login removal', () => {
  it('session stays valid after removing the login the student signed in with', async () => {
    const user = await makeUser({ primary_email: 'del-session@example.com', role: 'student' });
    const loginA = await makeLogin(user, { provider: 'google' });
    await makeLogin(user, { provider: 'github' });

    // Sign in (session is keyed to userId, not loginId)
    const agent = await loginAs('del-session@example.com', 'student');

    // Remove the google login (the one "used to sign in")
    const deleteRes = await agent.delete(`/api/account/logins/${loginA.id}`);
    expect(deleteRes.status).toBe(204);

    // Session must still be valid — GET /api/account should return 200
    const accountRes = await agent.get('/api/account');
    expect(accountRes.status).toBe(200);
    expect(accountRes.body.profile.primaryEmail).toBe('del-session@example.com');
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

// ---------------------------------------------------------------------------
// POST /api/account/provisioning-requests tests (T004)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test: POST workspace — 201 with one request row
// ---------------------------------------------------------------------------

describe('POST /api/account/provisioning-requests — workspace', () => {
  it('returns 201 with one request object and creates a DB row', async () => {
    const user = await makeUser({
      primary_email: 'pr-workspace@example.com',
      role: 'student',
    });
    await makeLogin(user);

    const agent = await loginAs('pr-workspace@example.com', 'student');
    const res = await agent
      .post('/api/account/provisioning-requests')
      .send({ requestType: 'workspace' });

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      requestedType: 'workspace',
      status: 'pending',
    });
    expect(res.body[0].id).toBeDefined();
    expect(res.body[0].createdAt).toBeDefined();
    expect(res.body[0].decidedAt).toBeNull();

    // Verify row exists in DB
    const rows = await (prisma as any).provisioningRequest.findMany({
      where: { user_id: user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].requested_type).toBe('workspace');
  });
});

// ---------------------------------------------------------------------------
// Test: POST workspace_and_claude with no workspace baseline — 422
// ---------------------------------------------------------------------------

describe('POST /api/account/provisioning-requests — workspace_and_claude (no baseline)', () => {
  it('returns 201 with two request rows when no baseline exists (workspace created in same tx)', async () => {
    const user = await makeUser({
      primary_email: 'pr-wac@example.com',
      role: 'student',
    });
    await makeLogin(user);

    const agent = await loginAs('pr-wac@example.com', 'student');
    const res = await agent
      .post('/api/account/provisioning-requests')
      .send({ requestType: 'workspace_and_claude' });

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);

    const types = res.body.map((r: any) => r.requestedType).sort();
    expect(types).toEqual(['claude', 'workspace']);

    // Verify both rows in DB
    const rows = await (prisma as any).provisioningRequest.findMany({
      where: { user_id: user.id },
    });
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Test: POST claude alone without workspace baseline — 422
// ---------------------------------------------------------------------------

describe('POST /api/account/provisioning-requests — claude alone, no workspace', () => {
  it('returns 422 when claude is requested but no workspace baseline exists', async () => {
    const user = await makeUser({
      primary_email: 'pr-claude-no-ws@example.com',
      role: 'student',
    });
    await makeLogin(user);

    const agent = await loginAs('pr-claude-no-ws@example.com', 'student');
    const res = await agent
      .post('/api/account/provisioning-requests')
      .send({ requestType: 'claude' });

    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Test: POST claude alone with active workspace ExternalAccount — 201
// ---------------------------------------------------------------------------

describe('POST /api/account/provisioning-requests — claude alone with active workspace', () => {
  it('returns 201 with one claude request when the user has an active workspace account', async () => {
    const user = await makeUser({
      primary_email: 'pr-claude-with-ws@example.com',
      role: 'student',
    });
    await makeLogin(user);
    await makeExternalAccount(user, { type: 'workspace', status: 'active' });

    const agent = await loginAs('pr-claude-with-ws@example.com', 'student');
    const res = await agent
      .post('/api/account/provisioning-requests')
      .send({ requestType: 'claude' });

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].requestedType).toBe('claude');
  });
});

// ---------------------------------------------------------------------------
// Test: POST duplicate pending workspace — 409
// ---------------------------------------------------------------------------

describe('POST /api/account/provisioning-requests — duplicate pending workspace', () => {
  it('returns 409 when the user already has a pending workspace request', async () => {
    const user = await makeUser({
      primary_email: 'pr-dup-ws@example.com',
      role: 'student',
    });
    await makeLogin(user);
    // Create an existing pending workspace request
    await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'pending' });

    const agent = await loginAs('pr-dup-ws@example.com', 'student');
    const res = await agent
      .post('/api/account/provisioning-requests')
      .send({ requestType: 'workspace' });

    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Test: POST invalid requestType — 400
// ---------------------------------------------------------------------------

describe('POST /api/account/provisioning-requests — invalid requestType', () => {
  it('returns 400 for an unrecognized requestType', async () => {
    const user = await makeUser({
      primary_email: 'pr-invalid@example.com',
      role: 'student',
    });
    await makeLogin(user);

    const agent = await loginAs('pr-invalid@example.com', 'student');
    const res = await agent
      .post('/api/account/provisioning-requests')
      .send({ requestType: 'notreal' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when requestType is missing', async () => {
    const user = await makeUser({
      primary_email: 'pr-missing@example.com',
      role: 'student',
    });
    await makeLogin(user);

    const agent = await loginAs('pr-missing@example.com', 'student');
    const res = await agent
      .post('/api/account/provisioning-requests')
      .send({});

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Test: POST unauthenticated — 401
// ---------------------------------------------------------------------------

describe('POST /api/account/provisioning-requests — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app)
      .post('/api/account/provisioning-requests')
      .send({ requestType: 'workspace' });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Test: POST staff role — 403
// ---------------------------------------------------------------------------

describe('POST /api/account/provisioning-requests — staff role', () => {
  it('returns 403 for a user with role=staff', async () => {
    await makeUser({ primary_email: 'pr-staff@example.com', role: 'staff' });

    const agent = await loginAs('pr-staff@example.com', 'staff');
    const res = await agent
      .post('/api/account/provisioning-requests')
      .send({ requestType: 'workspace' });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/account/provisioning-requests tests (T004)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test: GET returns student's own requests, newest first
// ---------------------------------------------------------------------------

describe('GET /api/account/provisioning-requests — authenticated student', () => {
  it('returns all requests for the signed-in student, newest first', async () => {
    const user = await makeUser({
      primary_email: 'pr-get-list@example.com',
      role: 'student',
    });
    await makeLogin(user);
    const req1 = await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'pending' });
    const req2 = await makeProvisioningRequest(user, { requested_type: 'claude', status: 'pending' });

    const agent = await loginAs('pr-get-list@example.com', 'student');
    const res = await agent.get('/api/account/provisioning-requests');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);

    // Newest first: req2 has a higher id (created after req1)
    expect(res.body[0].id).toBe(req2.id);
    expect(res.body[1].id).toBe(req1.id);

    expect(res.body[0]).toMatchObject({
      requestedType: 'claude',
      status: 'pending',
      decidedAt: null,
    });
  });

  it('returns an empty array when the student has no requests', async () => {
    const user = await makeUser({
      primary_email: 'pr-get-empty@example.com',
      role: 'student',
    });
    await makeLogin(user);

    const agent = await loginAs('pr-get-empty@example.com', 'student');
    const res = await agent.get('/api/account/provisioning-requests');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test: GET unauthenticated — 401
// ---------------------------------------------------------------------------

describe('GET /api/account/provisioning-requests — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).get('/api/account/provisioning-requests');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Test: GET staff role — 403
// ---------------------------------------------------------------------------

describe('GET /api/account/provisioning-requests — staff role', () => {
  it('returns 403 for a user with role=staff', async () => {
    await makeUser({ primary_email: 'pr-get-staff@example.com', role: 'staff' });

    const agent = await loginAs('pr-get-staff@example.com', 'staff');
    const res = await agent.get('/api/account/provisioning-requests');

    expect(res.status).toBe(403);
  });
});
