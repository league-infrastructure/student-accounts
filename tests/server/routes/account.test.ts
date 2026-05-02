/**
 * Integration tests for GET /api/account and DELETE /api/account/logins/:id
 * with non-student roles (Sprint 022 ticket 001).
 *
 * Verifies that removing requireRole('student') from these two endpoints
 * allows staff and admin users to access their own account data while keeping
 * the unauthenticated 401 and the ownership 404 intact.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../../server/src/app.js';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeUser, makeLogin } from '../helpers/factories.js';

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
 * Open a supertest agent authenticated as the given email/role via the
 * test-login endpoint. Creates the user record if it does not already exist.
 */
async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin',
  displayName = 'Test User',
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/test-login')
    .send({ email, displayName, role })
    .expect(200);
  return agent;
}

// ---------------------------------------------------------------------------
// GET /api/account — unauthenticated (regression)
// ---------------------------------------------------------------------------

describe('GET /api/account — unauthenticated', () => {
  it('returns 401 with no session', async () => {
    const res = await request(app).get('/api/account');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/account — non-student roles
// ---------------------------------------------------------------------------

describe('GET /api/account — non-student roles', () => {
  it('returns 200 for staff role', async () => {
    const agent = await loginAs('staff-account@example.com', 'staff', 'Staff User');
    const res = await agent.get('/api/account');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('profile');
    expect(res.body).toHaveProperty('logins');
    expect(res.body).toHaveProperty('externalAccounts');
  });

  it('returns 200 for admin role', async () => {
    const agent = await loginAs('admin-account@example.com', 'admin', 'Admin User');
    const res = await agent.get('/api/account');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('profile');
    expect(res.body).toHaveProperty('logins');
    expect(res.body).toHaveProperty('externalAccounts');
  });

  it('returns null cohort for non-student with no cohort assigned', async () => {
    const agent = await loginAs('staff-nocohort@example.com', 'staff', 'Staff NoCohort');
    const res = await agent.get('/api/account');
    expect(res.status).toBe(200);
    expect(res.body.profile.cohort).toBeNull();
  });

  it('returns null workspaceTempPassword for non-student with no workspace account', async () => {
    const agent = await loginAs('staff-noworkspace@example.com', 'staff', 'Staff NoWorkspace');
    const res = await agent.get('/api/account');
    expect(res.status).toBe(200);
    expect(res.body.profile.workspaceTempPassword).toBeNull();
  });

  it('returns false llmProxyEnabled for non-student with no LLM proxy token', async () => {
    const agent = await loginAs('staff-nollm@example.com', 'staff', 'Staff NoLLM');
    const res = await agent.get('/api/account');
    expect(res.status).toBe(200);
    expect(res.body.profile.llmProxyEnabled).toBe(false);
  });

  it('returns correct profile fields for staff user', async () => {
    const agent = await loginAs('staff-fields@example.com', 'staff', 'Staff Fields');
    const res = await agent.get('/api/account');
    expect(res.status).toBe(200);
    const profile = res.body.profile as Record<string, unknown>;
    expect(profile).toHaveProperty('id');
    expect(profile).toHaveProperty('displayName');
    expect(profile).toHaveProperty('primaryEmail', 'staff-fields@example.com');
    expect(profile).toHaveProperty('role', 'staff');
    expect(profile).toHaveProperty('createdAt');
    expect(profile).toHaveProperty('llmProxyEnabled', false);
    expect(profile).toHaveProperty('cohort', null);
  });

  it('returns logins array for staff user', async () => {
    const agent = await loginAs('staff-logins@example.com', 'staff', 'Staff Logins');
    const res = await agent.get('/api/account');
    expect(res.status).toBe(200);
    // The test-login endpoint creates a login record; logins array is non-empty.
    expect(Array.isArray(res.body.logins)).toBe(true);
  });

  it('returns empty externalAccounts for staff user with no provisioned accounts', async () => {
    const agent = await loginAs('staff-extacc@example.com', 'staff', 'Staff ExtAcc');
    const res = await agent.get('/api/account');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.externalAccounts)).toBe(true);
    expect(res.body.externalAccounts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/account/logins/:id — staff role
// ---------------------------------------------------------------------------

describe('DELETE /api/account/logins/:id — staff role', () => {
  it('removes own login and returns 204 for staff user with two logins', async () => {
    // Create a staff user directly so we can control their login records.
    const staffUser = await makeUser({ role: 'staff', primary_email: 'staff-delete@example.com' });

    // Create two logins so the at-least-one guard does not fire.
    const loginA = await makeLogin(staffUser, { provider: 'google', provider_email: 'staff-delete-a@gmail.com' });
    const loginB = await makeLogin(staffUser, { provider: 'github', provider_email: 'staff-delete-b@github.com' });

    // Authenticate as that user.
    const agent = request.agent(app);
    await agent
      .post('/api/auth/test-login')
      .send({ email: 'staff-delete@example.com', displayName: 'Staff Delete', role: 'staff' })
      .expect(200);

    const res = await agent.delete(`/api/account/logins/${loginA.id}`);
    expect(res.status).toBe(204);

    // Verify loginA is gone from the DB.
    const remaining = await (prisma as any).login.findUnique({ where: { id: loginA.id } });
    expect(remaining).toBeNull();

    // loginB must still be present.
    const kept = await (prisma as any).login.findUnique({ where: { id: loginB.id } });
    expect(kept).not.toBeNull();
  });

  it('returns 404 when login ID belongs to another user (ownership check unchanged)', async () => {
    // Create a second user with their own login.
    const otherUser = await makeUser({ role: 'student', primary_email: 'other-user-delete@example.com' });
    const otherLogin = await makeLogin(otherUser, { provider: 'google' });

    // Authenticate as staff.
    const agent = await loginAs('staff-ownership@example.com', 'staff', 'Staff Ownership');

    const res = await agent.delete(`/api/account/logins/${otherLogin.id}`);
    expect(res.status).toBe(404);
  });
});
