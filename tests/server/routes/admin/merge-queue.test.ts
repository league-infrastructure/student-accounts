/**
 * Integration tests for admin merge-queue routes (Sprint 007 T005).
 *
 * Covers:
 *  - GET  /api/admin/merge-queue:            401, 403, 200 (list)
 *  - GET  /api/admin/merge-queue/:id:        401, 403, 200, 404
 *  - POST /api/admin/merge-queue/:id/approve: 401, 403, 200, 400 (missing/bad survivorId), 409 (already decided)
 *  - POST /api/admin/merge-queue/:id/reject:  401, 403, 200
 *  - POST /api/admin/merge-queue/:id/defer:   401, 403, 200
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { makeUser, makeLogin, makeExternalAccount, makeMergeSuggestion } from '../../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app from '../../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
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
// GET /api/admin/merge-queue — unauthenticated
// ---------------------------------------------------------------------------

describe('GET /api/admin/merge-queue — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).get('/api/admin/merge-queue');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/merge-queue — non-admin
// ---------------------------------------------------------------------------

describe('GET /api/admin/merge-queue — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student-mq@example.com', role: 'student' });
    const agent = await loginAs('student-mq@example.com', 'student');
    const res = await agent.get('/api/admin/merge-queue');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/merge-queue — admin (list)
// ---------------------------------------------------------------------------

describe('GET /api/admin/merge-queue — admin', () => {
  it('returns 200 with pending and deferred suggestions including user summaries', async () => {
    await makeUser({ primary_email: 'admin-mq@example.com', role: 'admin' });
    const userA = await makeUser({ primary_email: 'user-a@example.com', display_name: 'Alice' });
    const userB = await makeUser({ primary_email: 'user-b@example.com', display_name: 'Bob' });
    const userC = await makeUser({ primary_email: 'user-c@example.com', display_name: 'Carol' });
    const userD = await makeUser({ primary_email: 'user-d@example.com', display_name: 'Dave' });

    const pending = await makeMergeSuggestion(userA, userB, { status: 'pending', haiku_confidence: 0.9 });
    const deferred = await makeMergeSuggestion(userC, userD, { status: 'deferred', haiku_confidence: 0.6 });
    // Approved suggestion — should NOT appear in queue
    await makeMergeSuggestion(userA, userC, { status: 'approved' });

    const agent = await loginAs('admin-mq@example.com', 'admin');
    const res = await agent.get('/api/admin/merge-queue');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);

    const ids = res.body.map((item: any) => item.id);
    expect(ids).toContain(pending.id);
    expect(ids).toContain(deferred.id);

    const pendingItem = res.body.find((item: any) => item.id === pending.id);
    expect(pendingItem.user_a).toMatchObject({ id: userA.id, display_name: 'Alice', primary_email: 'user-a@example.com' });
    expect(pendingItem.user_b).toMatchObject({ id: userB.id, display_name: 'Bob', primary_email: 'user-b@example.com' });
    expect(pendingItem.haiku_confidence).toBe(0.9);
    expect(pendingItem.status).toBe('pending');
  });

  it('returns an empty array when no pending/deferred suggestions exist', async () => {
    await makeUser({ primary_email: 'admin-mq-empty@example.com', role: 'admin' });
    const agent = await loginAs('admin-mq-empty@example.com', 'admin');
    const res = await agent.get('/api/admin/merge-queue');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/merge-queue/:id — detail view
// ---------------------------------------------------------------------------

describe('GET /api/admin/merge-queue/:id — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).get('/api/admin/merge-queue/1');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/merge-queue/:id — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student-mq-detail@example.com', role: 'student' });
    const agent = await loginAs('student-mq-detail@example.com', 'student');
    const res = await agent.get('/api/admin/merge-queue/1');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/merge-queue/:id — admin', () => {
  it('returns 404 when the suggestion does not exist', async () => {
    await makeUser({ primary_email: 'admin-mq-404@example.com', role: 'admin' });
    const agent = await loginAs('admin-mq-404@example.com', 'admin');
    const res = await agent.get('/api/admin/merge-queue/99999');
    expect(res.status).toBe(404);
  });

  it('returns 200 with full user data including Logins and ExternalAccounts', async () => {
    await makeUser({ primary_email: 'admin-mq-detail@example.com', role: 'admin' });
    const userA = await makeUser({ primary_email: 'detail-a@example.com', display_name: 'Alice Detail' });
    const userB = await makeUser({ primary_email: 'detail-b@example.com', display_name: 'Bob Detail' });

    await makeLogin(userA, { provider: 'google' });
    await makeExternalAccount(userA, { type: 'workspace', status: 'active' });
    await makeLogin(userB, { provider: 'github' });

    const suggestion = await makeMergeSuggestion(userA, userB, { status: 'pending' });

    const agent = await loginAs('admin-mq-detail@example.com', 'admin');
    const res = await agent.get(`/api/admin/merge-queue/${suggestion.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(suggestion.id);
    expect(res.body.status).toBe('pending');

    expect(res.body.user_a).toMatchObject({
      id: userA.id,
      display_name: 'Alice Detail',
      primary_email: 'detail-a@example.com',
    });
    expect(Array.isArray(res.body.user_a.logins)).toBe(true);
    expect(res.body.user_a.logins.length).toBeGreaterThanOrEqual(1);
    expect(res.body.user_a.logins[0]).toMatchObject({ provider: 'google' });
    expect(Array.isArray(res.body.user_a.external_accounts)).toBe(true);

    expect(res.body.user_b).toMatchObject({ id: userB.id });
    expect(Array.isArray(res.body.user_b.logins)).toBe(true);
    expect(Array.isArray(res.body.user_b.external_accounts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/merge-queue/:id/approve
// ---------------------------------------------------------------------------

describe('POST /api/admin/merge-queue/:id/approve — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).post('/api/admin/merge-queue/1/approve').send({ survivorId: 1 });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/merge-queue/:id/approve — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student-mq-approve@example.com', role: 'student' });
    const agent = await loginAs('student-mq-approve@example.com', 'student');
    const res = await agent.post('/api/admin/merge-queue/1/approve').send({ survivorId: 1 });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/merge-queue/:id/approve — admin', () => {
  it('returns 400 when survivorId is missing', async () => {
    await makeUser({ primary_email: 'admin-approve-missing@example.com', role: 'admin' });
    const userA = await makeUser({ primary_email: 'approve-a1@example.com' });
    const userB = await makeUser({ primary_email: 'approve-b1@example.com' });
    const suggestion = await makeMergeSuggestion(userA, userB, { status: 'pending' });

    const agent = await loginAs('admin-approve-missing@example.com', 'admin');
    const res = await agent.post(`/api/admin/merge-queue/${suggestion.id}/approve`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when survivorId is not a number', async () => {
    await makeUser({ primary_email: 'admin-approve-badtype@example.com', role: 'admin' });
    const userA = await makeUser({ primary_email: 'approve-a2@example.com' });
    const userB = await makeUser({ primary_email: 'approve-b2@example.com' });
    const suggestion = await makeMergeSuggestion(userA, userB, { status: 'pending' });

    const agent = await loginAs('admin-approve-badtype@example.com', 'admin');
    const res = await agent.post(`/api/admin/merge-queue/${suggestion.id}/approve`).send({ survivorId: 'not-a-number' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when survivorId is not part of the suggestion pair', async () => {
    await makeUser({ primary_email: 'admin-approve-wrongsurviv@example.com', role: 'admin' });
    const userA = await makeUser({ primary_email: 'approve-a3@example.com' });
    const userB = await makeUser({ primary_email: 'approve-b3@example.com' });
    const userOther = await makeUser({ primary_email: 'approve-other@example.com' });
    const suggestion = await makeMergeSuggestion(userA, userB, { status: 'pending' });

    const agent = await loginAs('admin-approve-wrongsurviv@example.com', 'admin');
    const res = await agent
      .post(`/api/admin/merge-queue/${suggestion.id}/approve`)
      .send({ survivorId: userOther.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 409 when the suggestion is already approved', async () => {
    const admin = await makeUser({ primary_email: 'admin-approve-409@example.com', role: 'admin' });
    const userA = await makeUser({ primary_email: 'approve-a4@example.com' });
    const userB = await makeUser({ primary_email: 'approve-b4@example.com' });
    const suggestion = await makeMergeSuggestion(userA, userB, {
      status: 'approved',
      decided_by: admin.id,
      decided_at: new Date(),
    });

    const agent = await loginAs('admin-approve-409@example.com', 'admin');
    const res = await agent
      .post(`/api/admin/merge-queue/${suggestion.id}/approve`)
      .send({ survivorId: userA.id });

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });

  it('returns 200 and merges users when survivorId is valid', async () => {
    await makeUser({ primary_email: 'admin-approve-ok@example.com', role: 'admin' });
    const userA = await makeUser({ primary_email: 'approve-a5@example.com' });
    const userB = await makeUser({ primary_email: 'approve-b5@example.com' });
    const suggestion = await makeMergeSuggestion(userA, userB, { status: 'pending' });

    const agent = await loginAs('admin-approve-ok@example.com', 'admin');
    const res = await agent
      .post(`/api/admin/merge-queue/${suggestion.id}/approve`)
      .send({ survivorId: userA.id });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify suggestion is now approved in DB
    const dbRow = await (prisma as any).mergeSuggestion.findUnique({ where: { id: suggestion.id } });
    expect(dbRow.status).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/merge-queue/:id/reject
// ---------------------------------------------------------------------------

describe('POST /api/admin/merge-queue/:id/reject — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).post('/api/admin/merge-queue/1/reject');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/merge-queue/:id/reject — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student-mq-reject@example.com', role: 'student' });
    const agent = await loginAs('student-mq-reject@example.com', 'student');
    const res = await agent.post('/api/admin/merge-queue/1/reject');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/merge-queue/:id/reject — admin', () => {
  it('returns 200 and marks the suggestion rejected', async () => {
    await makeUser({ primary_email: 'admin-reject-ok@example.com', role: 'admin' });
    const userA = await makeUser({ primary_email: 'reject-a@example.com' });
    const userB = await makeUser({ primary_email: 'reject-b@example.com' });
    const suggestion = await makeMergeSuggestion(userA, userB, { status: 'pending' });

    const agent = await loginAs('admin-reject-ok@example.com', 'admin');
    const res = await agent.post(`/api/admin/merge-queue/${suggestion.id}/reject`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const dbRow = await (prisma as any).mergeSuggestion.findUnique({ where: { id: suggestion.id } });
    expect(dbRow.status).toBe('rejected');
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/merge-queue/:id/defer
// ---------------------------------------------------------------------------

describe('POST /api/admin/merge-queue/:id/defer — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).post('/api/admin/merge-queue/1/defer');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/merge-queue/:id/defer — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student-mq-defer@example.com', role: 'student' });
    const agent = await loginAs('student-mq-defer@example.com', 'student');
    const res = await agent.post('/api/admin/merge-queue/1/defer');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/merge-queue/:id/defer — admin', () => {
  it('returns 200 and marks the suggestion deferred', async () => {
    await makeUser({ primary_email: 'admin-defer-ok@example.com', role: 'admin' });
    const userA = await makeUser({ primary_email: 'defer-a@example.com' });
    const userB = await makeUser({ primary_email: 'defer-b@example.com' });
    const suggestion = await makeMergeSuggestion(userA, userB, { status: 'pending' });

    const agent = await loginAs('admin-defer-ok@example.com', 'admin');
    const res = await agent.post(`/api/admin/merge-queue/${suggestion.id}/defer`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const dbRow = await (prisma as any).mergeSuggestion.findUnique({ where: { id: suggestion.id } });
    expect(dbRow.status).toBe('deferred');
  });
});
