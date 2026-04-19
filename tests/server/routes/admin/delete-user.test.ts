/**
 * Integration tests for DELETE /api/admin/users/:id (Sprint 009 T003).
 *
 * Covers:
 *  - 403 when the actor attempts to delete their own account
 *  - 404 when the target user does not exist
 *  - 200 + is_active=false + AuditEvent on success
 *  - deleted user absent from GET /api/admin/users
 *  - 401 when unauthenticated
 *  - 403 when authenticated as non-admin
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { makeUser } from '../../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app from '../../../../server/src/app.js';

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

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
});

// ---------------------------------------------------------------------------
// 401 — unauthenticated
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/users/:id — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).delete('/api/admin/users/999');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 403 — non-admin role
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/users/:id — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student@example.com', role: 'student' });
    const agent = await loginAs('student@example.com', 'student');
    const res = await agent.delete('/api/admin/users/999');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 403 — self-delete blocked
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/users/:id — self-delete blocked (403)', () => {
  it('returns 403 when admin tries to delete their own account', async () => {
    const admin = await makeUser({ primary_email: 'admin-self@example.com', role: 'admin' });
    const agent = await loginAs('admin-self@example.com', 'admin');

    const res = await agent.delete(`/api/admin/users/${admin.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/own account/i);
  });
});

// ---------------------------------------------------------------------------
// 404 — user not found
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/users/:id — user not found (404)', () => {
  it('returns 404 when target user does not exist', async () => {
    await makeUser({ primary_email: 'admin-404@example.com', role: 'admin' });
    const agent = await loginAs('admin-404@example.com', 'admin');

    const res = await agent.delete('/api/admin/users/999999');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// 200 — success
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/users/:id — success (200)', () => {
  it('soft-deletes user, records AuditEvent, returns { success: true }', async () => {
    const admin = await makeUser({ primary_email: 'admin-del@example.com', role: 'admin' });
    const target = await makeUser({ primary_email: 'target-del@example.com', role: 'student' });
    const agent = await loginAs('admin-del@example.com', 'admin');

    const res = await agent.delete(`/api/admin/users/${target.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // User must be soft-deleted (is_active=false) — not hard-deleted
    const dbUser = await (prisma as any).user.findUnique({ where: { id: target.id } });
    expect(dbUser).not.toBeNull();
    expect(dbUser.is_active).toBe(false);

    // AuditEvent must exist
    const audit = await (prisma as any).auditEvent.findFirst({
      where: { action: 'delete_user', target_user_id: target.id },
    });
    expect(audit).not.toBeNull();
    expect(audit.actor_user_id).toBe(admin.id);
  });

  it('deleted user does not appear in GET /api/admin/users', async () => {
    await makeUser({ primary_email: 'admin-list@example.com', role: 'admin' });
    const target = await makeUser({ primary_email: 'target-list@example.com', role: 'student' });
    const agent = await loginAs('admin-list@example.com', 'admin');

    await agent.delete(`/api/admin/users/${target.id}`);

    const listRes = await agent.get('/api/admin/users');
    expect(listRes.status).toBe(200);
    const ids = listRes.body.map((u: any) => u.id);
    expect(ids).not.toContain(target.id);
  });
});
