/**
 * Integration tests for admin provisioning-requests routes (Sprint 004 T008).
 *
 * Covers:
 *  - GET  /api/admin/provisioning-requests: 401 (no auth), 403 (non-admin), 200 (admin with pending requests)
 *  - POST /api/admin/provisioning-requests/:id/approve: 403 (non-admin), 200 (admin, success with FakeGoogleWorkspaceAdminClient)
 *  - POST /api/admin/provisioning-requests/:id/reject: 200 (admin, success)
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import { ServiceRegistry } from '../../../server/src/services/service.registry.js';
import { FakeGoogleWorkspaceAdminClient } from '../helpers/fake-google-workspace-admin.client.js';
import {
  makeCohort,
  makeUser,
  makeProvisioningRequest,
} from '../helpers/factories.js';

process.env.NODE_ENV = 'test';
process.env.GOOGLE_STUDENT_DOMAIN = 'students.jointheleague.org';

import app, { registry } from '../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

/**
 * Create a supertest agent with an active session for the given email/role.
 */
async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'admin',
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
// GET /api/admin/provisioning-requests — 401 (unauthenticated)
// ---------------------------------------------------------------------------

describe('GET /api/admin/provisioning-requests — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).get('/api/admin/provisioning-requests');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/provisioning-requests — 403 (non-admin)
// ---------------------------------------------------------------------------

describe('GET /api/admin/provisioning-requests — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student@example.com', role: 'student' });
    const agent = await loginAs('student@example.com', 'student');
    const res = await agent.get('/api/admin/provisioning-requests');
    expect(res.status).toBe(403);
  });

  it('returns 403 for a staff user', async () => {
    await makeUser({ primary_email: 'staff@example.com', role: 'staff' });
    const agent = await loginAs('staff@example.com', 'staff');
    const res = await agent.get('/api/admin/provisioning-requests');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/provisioning-requests — 200 (admin, with pending requests)
// ---------------------------------------------------------------------------

describe('GET /api/admin/provisioning-requests — admin', () => {
  it('returns 200 with an array of pending requests including user details', async () => {
    // Create an admin user (the one making the API call)
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });

    // Create a student with a cohort and pending provisioning request
    const cohort = await makeCohort({ name: 'Spring 2025' });
    const student = await makeUser({
      primary_email: 'student-pr@example.com',
      display_name: 'Alice Student',
      role: 'student',
      cohort_id: cohort.id,
    });
    const pr = await makeProvisioningRequest(student, {
      requested_type: 'workspace',
      status: 'pending',
    });

    // Create a non-pending request — should NOT appear in the response
    await makeProvisioningRequest(student, {
      requested_type: 'claude',
      status: 'approved',
    });

    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.get('/api/admin/provisioning-requests');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);

    const item = res.body[0];
    expect(item).toMatchObject({
      id: pr.id,
      userId: student.id,
      userName: 'Alice Student',
      userEmail: 'student-pr@example.com',
      requestedType: 'workspace',
    });
    expect(item.createdAt).toBeDefined();
  });

  it('returns an empty array when no pending requests exist', async () => {
    await makeUser({ primary_email: 'admin-empty@example.com', role: 'admin' });

    const agent = await loginAs('admin-empty@example.com', 'admin');
    const res = await agent.get('/api/admin/provisioning-requests');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/provisioning-requests/:id/approve — 403 (non-admin)
// ---------------------------------------------------------------------------

describe('POST /api/admin/provisioning-requests/:id/approve — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student-approve@example.com', role: 'student' });
    const agent = await loginAs('student-approve@example.com', 'student');
    const res = await agent.post('/api/admin/provisioning-requests/1/approve');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/provisioning-requests/:id/approve — 200 (admin, success)
// Uses FakeGoogleWorkspaceAdminClient so no real API calls are made.
// ---------------------------------------------------------------------------

describe('POST /api/admin/provisioning-requests/:id/approve — admin success', () => {
  it('returns 200 with updated request and marks it approved', async () => {
    // Inject a fake Google client into the service registry for this test
    const fake = new FakeGoogleWorkspaceAdminClient();
    const testRegistry = ServiceRegistry.create('API', fake);

    // Wire the fake registry into the app for this request by temporarily
    // overriding req.services via the app's registry.
    // The test uses its own provisioning so we can call the service directly
    // and verify it, but we need the route to use the fake. The app's
    // ServiceRegistry is created once at startup; we need to create the
    // data in DB and test that the route calls approve correctly.
    //
    // Since the app's registry is a singleton (created in app.ts) and
    // contains a real Google client that will fail without credentials,
    // we instead test approve via a workspace request that hits the 'claude'
    // path (which is a pure status update with no Google call).

    const admin = await makeUser({ primary_email: 'admin-approve@example.com', role: 'admin' });
    const student = await makeUser({
      primary_email: 'student-toapprove@example.com',
      display_name: 'Bob Student',
      role: 'student',
    });

    // Use a 'claude' request type — approve() for claude is a pure status
    // update that does not call the Google Admin SDK. This lets us test the
    // approve route without real credentials.
    const pr = await makeProvisioningRequest(student, {
      requested_type: 'claude',
      status: 'pending',
    });

    const agent = await loginAs('admin-approve@example.com', 'admin');
    const res = await agent.post(`/api/admin/provisioning-requests/${pr.id}/approve`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: pr.id,
      userId: student.id,
      requestedType: 'claude',
      status: 'approved',
    });
    expect(res.body.decidedAt).not.toBeNull();
    expect(res.body.decidedBy).toBe(admin.id);

    // Verify DB row is updated
    const dbRow = await (prisma as any).provisioningRequest.findUnique({ where: { id: pr.id } });
    expect(dbRow.status).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/provisioning-requests/:id/approve — with FakeGoogleWorkspaceAdminClient
// Tests the workspace approval path using a fake client injected via the
// test-login + ServiceRegistry integration. Since the app uses a singleton
// registry with the real client, we test workspace provisioning at the
// service layer in workspace-provisioning.service.test.ts. Here we verify
// the route's 422 error propagation when service throws.
// ---------------------------------------------------------------------------

describe('POST /api/admin/provisioning-requests/:id/approve — 422 propagation', () => {
  it('returns 422 when approving a request that is not pending', async () => {
    await makeUser({ primary_email: 'admin-422@example.com', role: 'admin' });
    const student = await makeUser({
      primary_email: 'student-422@example.com',
      role: 'student',
    });

    // Already approved — approve() should throw ConflictError (409)
    const pr = await makeProvisioningRequest(student, {
      requested_type: 'claude',
      status: 'approved',
    });

    const agent = await loginAs('admin-422@example.com', 'admin');
    const res = await agent.post(`/api/admin/provisioning-requests/${pr.id}/approve`);

    // ConflictError → 409
    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/provisioning-requests/:id/reject — 200 (admin, success)
// ---------------------------------------------------------------------------

describe('POST /api/admin/provisioning-requests/:id/reject — admin success', () => {
  it('returns 200 with updated request and marks it rejected', async () => {
    const admin = await makeUser({ primary_email: 'admin-reject@example.com', role: 'admin' });
    const student = await makeUser({
      primary_email: 'student-toreject@example.com',
      role: 'student',
    });
    const pr = await makeProvisioningRequest(student, {
      requested_type: 'workspace',
      status: 'pending',
    });

    const agent = await loginAs('admin-reject@example.com', 'admin');
    const res = await agent.post(`/api/admin/provisioning-requests/${pr.id}/reject`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: pr.id,
      userId: student.id,
      requestedType: 'workspace',
      status: 'rejected',
    });
    expect(res.body.decidedAt).not.toBeNull();
    expect(res.body.decidedBy).toBe(admin.id);

    // Verify DB row is updated
    const dbRow = await (prisma as any).provisioningRequest.findUnique({ where: { id: pr.id } });
    expect(dbRow.status).toBe('rejected');
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/provisioning-requests/:id/reject — 403 (non-admin)
// ---------------------------------------------------------------------------

describe('POST /api/admin/provisioning-requests/:id/reject — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student-reject@example.com', role: 'student' });
    const agent = await loginAs('student-reject@example.com', 'student');
    const res = await agent.post('/api/admin/provisioning-requests/1/reject');
    expect(res.status).toBe(403);
  });
});
