/**
 * Integration tests for admin user-logins routes (Sprint 005 T010).
 *
 * Covers:
 *  POST /api/admin/users/:id/logins
 *   - 201 created (google login, no pike13 stub call)
 *   - 201 created (github login without pike13 account, stub NOT called)
 *   - 201 created (github login with pike13 account, stub IS called)
 *   - 409 when providerUserId already associated with another user
 *   - 400 when provider is missing
 *   - 400 when providerUserId is missing
 *   - 403 for non-admin
 *  DELETE /api/admin/users/:id/logins/:loginId
 *   - 204 on success
 *   - 422 when it's the last login for the user
 *   - 404 when loginId does not exist
 *   - 404 when loginId belongs to a different user
 *   - 403 for non-admin
 */

import request from 'supertest';
import { vi } from 'vitest';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeUser, makeLogin, makeExternalAccount } from '../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app from '../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Spy on pike13WritebackStub.githubHandle
// ---------------------------------------------------------------------------

import * as pike13WritebackStub from '../../../server/src/services/pike13-writeback.stub.js';

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

let githubHandleSpy: jest.SpyInstance;

beforeEach(async () => {
  await cleanDb();
  githubHandleSpy = vi.spyOn(pike13WritebackStub, 'githubHandle').mockResolvedValue(undefined);
});

afterEach(() => {
  githubHandleSpy.mockRestore();
});

afterAll(async () => {
  await cleanDb();
});

// ===========================================================================
// POST /api/admin/users/:id/logins
// ===========================================================================

describe('POST /api/admin/users/:id/logins — 403 (non-admin)', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student@example.com', role: 'student' });
    const agent = await loginAs('student@example.com', 'student');
    const res = await agent
      .post('/api/admin/users/999/logins')
      .send({ provider: 'google', providerUserId: 'gid_1' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/users/:id/logins — 400 (missing fields)', () => {
  it('returns 400 when provider is missing', async () => {
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    const agent = await loginAs('admin@example.com');
    const target = await makeUser({ primary_email: 'target@example.com', role: 'student' });
    const res = await agent
      .post(`/api/admin/users/${target.id}/logins`)
      .send({ providerUserId: 'uid_1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/provider/i);
  });

  it('returns 400 when providerUserId is missing', async () => {
    await makeUser({ primary_email: 'admin2@example.com', role: 'admin' });
    const agent = await loginAs('admin2@example.com');
    const target = await makeUser({ primary_email: 'target2@example.com', role: 'student' });
    const res = await agent
      .post(`/api/admin/users/${target.id}/logins`)
      .send({ provider: 'google' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/providerUserId/i);
  });
});

describe('POST /api/admin/users/:id/logins — 201 (google login created)', () => {
  it('creates the login and returns 201, does NOT call githubHandle stub', async () => {
    await makeUser({ primary_email: 'admin-g@example.com', role: 'admin' });
    const agent = await loginAs('admin-g@example.com');
    const target = await makeUser({ primary_email: 'target-g@example.com', role: 'student' });

    const res = await agent
      .post(`/api/admin/users/${target.id}/logins`)
      .send({
        provider: 'google',
        providerUserId: 'google_uid_new',
        providerEmail: 'target-g@gmail.com',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      userId: target.id,
      provider: 'google',
      providerUserId: 'google_uid_new',
      providerEmail: 'target-g@gmail.com',
    });
    expect(res.body.id).toBeDefined();

    // Verify DB record exists
    const dbLogin = await (prisma as any).login.findUnique({ where: { id: res.body.id } });
    expect(dbLogin).not.toBeNull();
    expect(dbLogin.user_id).toBe(target.id);

    // Verify audit event was recorded
    const audit = await (prisma as any).auditEvent.findFirst({
      where: { action: 'add_login', target_user_id: target.id },
    });
    expect(audit).not.toBeNull();

    // githubHandle stub must NOT be called for a google login
    expect(githubHandleSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/users/:id/logins — 201 (github login, no pike13 account)', () => {
  it('creates the github login and does NOT call githubHandle when user has no pike13 account', async () => {
    await makeUser({ primary_email: 'admin-gh-nop@example.com', role: 'admin' });
    const agent = await loginAs('admin-gh-nop@example.com');
    const target = await makeUser({ primary_email: 'target-gh-nop@example.com', role: 'student' });

    const res = await agent
      .post(`/api/admin/users/${target.id}/logins`)
      .send({
        provider: 'github',
        providerUserId: 'gh_uid_1',
        providerUsername: 'ghuser1',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      userId: target.id,
      provider: 'github',
      providerUserId: 'gh_uid_1',
      providerUsername: 'ghuser1',
    });

    // No pike13 account → stub NOT called
    expect(githubHandleSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/users/:id/logins — 201 (github login, with pike13 account)', () => {
  it('creates the github login and calls githubHandle when user has an active pike13 account', async () => {
    await makeUser({ primary_email: 'admin-gh-p@example.com', role: 'admin' });
    const agent = await loginAs('admin-gh-p@example.com');
    const target = await makeUser({ primary_email: 'target-gh-p@example.com', role: 'student' });

    // Give target a pike13 ExternalAccount
    await makeExternalAccount(target, { type: 'pike13', status: 'active', external_id: 'p13_ext_1' });

    const res = await agent
      .post(`/api/admin/users/${target.id}/logins`)
      .send({
        provider: 'github',
        providerUserId: 'gh_uid_2',
        providerUsername: 'ghuser2',
      });

    expect(res.status).toBe(201);

    // pike13 account present → stub called with correct args
    expect(githubHandleSpy).toHaveBeenCalledTimes(1);
    expect(githubHandleSpy).toHaveBeenCalledWith(target.id, 'ghuser2');
  });

  it('uses providerUserId as handle when providerUsername is absent', async () => {
    await makeUser({ primary_email: 'admin-gh-p2@example.com', role: 'admin' });
    const agent = await loginAs('admin-gh-p2@example.com');
    const target = await makeUser({ primary_email: 'target-gh-p2@example.com', role: 'student' });

    await makeExternalAccount(target, { type: 'pike13', status: 'active', external_id: 'p13_ext_2' });

    const res = await agent
      .post(`/api/admin/users/${target.id}/logins`)
      .send({
        provider: 'github',
        providerUserId: 'gh_uid_nousername',
        // no providerUsername
      });

    expect(res.status).toBe(201);
    expect(githubHandleSpy).toHaveBeenCalledWith(target.id, 'gh_uid_nousername');
  });
});

describe('POST /api/admin/users/:id/logins — 409 (duplicate providerUserId)', () => {
  it('returns 409 when the providerUserId is already associated with another user', async () => {
    await makeUser({ primary_email: 'admin-409@example.com', role: 'admin' });
    const agent = await loginAs('admin-409@example.com');

    const existing = await makeUser({ primary_email: 'existing@example.com', role: 'student' });
    await makeLogin(existing, { provider: 'google', provider_user_id: 'dup_uid' });

    const target = await makeUser({ primary_email: 'target-409@example.com', role: 'student' });

    const res = await agent
      .post(`/api/admin/users/${target.id}/logins`)
      .send({ provider: 'google', providerUserId: 'dup_uid' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });
});

// ===========================================================================
// DELETE /api/admin/users/:id/logins/:loginId
// ===========================================================================

describe('DELETE /api/admin/users/:id/logins/:loginId — 403 (non-admin)', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student-del@example.com', role: 'student' });
    const agent = await loginAs('student-del@example.com', 'student');
    const res = await agent.delete('/api/admin/users/999/logins/1');
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/users/:id/logins/:loginId — 404 (not found)', () => {
  it('returns 404 when the loginId does not exist', async () => {
    await makeUser({ primary_email: 'admin-del-404@example.com', role: 'admin' });
    const agent = await loginAs('admin-del-404@example.com');
    const target = await makeUser({ primary_email: 'target-del-404@example.com', role: 'student' });

    const res = await agent.delete(`/api/admin/users/${target.id}/logins/999999`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the login belongs to a different user', async () => {
    await makeUser({ primary_email: 'admin-del-wrong@example.com', role: 'admin' });
    const agent = await loginAs('admin-del-wrong@example.com');

    const ownerUser = await makeUser({ primary_email: 'owner@example.com', role: 'student' });
    const login = await makeLogin(ownerUser, { provider: 'google', provider_user_id: 'g_other' });

    const otherUser = await makeUser({ primary_email: 'other@example.com', role: 'student' });

    const res = await agent.delete(`/api/admin/users/${otherUser.id}/logins/${login.id}`);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/users/:id/logins/:loginId — 422 (last login)', () => {
  it('returns 422 when removing the login would leave the user with zero logins', async () => {
    await makeUser({ primary_email: 'admin-del-422@example.com', role: 'admin' });
    const agent = await loginAs('admin-del-422@example.com');

    const target = await makeUser({ primary_email: 'target-del-422@example.com', role: 'student' });
    const login = await makeLogin(target, { provider: 'google', provider_user_id: 'only_login' });

    const res = await agent.delete(`/api/admin/users/${target.id}/logins/${login.id}`);
    expect(res.status).toBe(422);
    expect(res.body.error).toBeDefined();
  });
});

describe('DELETE /api/admin/users/:id/logins/:loginId — 204 (success)', () => {
  it('deletes the login and returns 204, records audit event', async () => {
    await makeUser({ primary_email: 'admin-del-ok@example.com', role: 'admin' });
    const agent = await loginAs('admin-del-ok@example.com');

    const target = await makeUser({ primary_email: 'target-del-ok@example.com', role: 'student' });
    const loginA = await makeLogin(target, { provider: 'google', provider_user_id: 'g_keep' });
    const loginB = await makeLogin(target, { provider: 'github', provider_user_id: 'gh_del' });

    const res = await agent.delete(`/api/admin/users/${target.id}/logins/${loginB.id}`);
    expect(res.status).toBe(204);

    // Verify login is gone from DB
    const deleted = await (prisma as any).login.findUnique({ where: { id: loginB.id } });
    expect(deleted).toBeNull();

    // loginA must still exist
    const remaining = await (prisma as any).login.findUnique({ where: { id: loginA.id } });
    expect(remaining).not.toBeNull();

    // Verify audit event
    const audit = await (prisma as any).auditEvent.findFirst({
      where: { action: 'remove_login', target_user_id: target.id },
    });
    expect(audit).not.toBeNull();
  });
});
