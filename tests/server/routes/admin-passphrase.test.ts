/**
 * Integration tests for admin passphrase routes (Sprint 015 T004).
 *
 * Covers POST / GET / DELETE /api/admin/cohorts/:id/passphrase
 * and   POST / GET / DELETE /api/admin/groups/:id/passphrase.
 *
 * Uses the real SQLite test database via the shared prisma client.
 * Auth is exercised via /api/auth/test-login.
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
  // Clear passphrase fields first (they are columns, not separate rows).
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
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).group.deleteMany();
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

// ===========================================================================
// COHORT PASSPHRASE ROUTES
// ===========================================================================

// ---------------------------------------------------------------------------
// 401 — unauthenticated
// ---------------------------------------------------------------------------

describe('Cohort passphrase routes — unauthenticated (401)', () => {
  it('POST /api/admin/cohorts/:id/passphrase returns 401 with no session', async () => {
    const cohort = await makeCohort({ name: 'Auth Cohort' });
    const res = await request(app)
      .post(`/api/admin/cohorts/${cohort.id}/passphrase`)
      .send({ grantLlmProxy: false });
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/cohorts/:id/passphrase returns 401 with no session', async () => {
    const cohort = await makeCohort({ name: 'Auth Cohort GET' });
    const res = await request(app).get(`/api/admin/cohorts/${cohort.id}/passphrase`);
    expect(res.status).toBe(401);
  });

  it('DELETE /api/admin/cohorts/:id/passphrase returns 401 with no session', async () => {
    const cohort = await makeCohort({ name: 'Auth Cohort DELETE' });
    const res = await request(app).delete(`/api/admin/cohorts/${cohort.id}/passphrase`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 403 — student / staff roles
// ---------------------------------------------------------------------------

describe('Cohort passphrase routes — non-admin (403)', () => {
  it('POST returns 403 for student', async () => {
    await makeUser({ primary_email: 'student-cohort@example.com', role: 'student' });
    const cohort = await makeCohort({ name: 'Student Cohort' });
    const agent = await loginAs('student-cohort@example.com', 'student');
    const res = await agent
      .post(`/api/admin/cohorts/${cohort.id}/passphrase`)
      .send({ grantLlmProxy: false });
    expect(res.status).toBe(403);
  });

  it('POST returns 403 for staff', async () => {
    await makeUser({ primary_email: 'staff-cohort@example.com', role: 'staff' });
    const cohort = await makeCohort({ name: 'Staff Cohort' });
    const agent = await loginAs('staff-cohort@example.com', 'staff');
    const res = await agent
      .post(`/api/admin/cohorts/${cohort.id}/passphrase`)
      .send({ grantLlmProxy: false });
    expect(res.status).toBe(403);
  });

  it('GET returns 403 for student', async () => {
    await makeUser({ primary_email: 'student-cohort-get@example.com', role: 'student' });
    const cohort = await makeCohort({ name: 'Student Cohort GET' });
    const agent = await loginAs('student-cohort-get@example.com', 'student');
    const res = await agent.get(`/api/admin/cohorts/${cohort.id}/passphrase`);
    expect(res.status).toBe(403);
  });

  it('DELETE returns 403 for student', async () => {
    await makeUser({ primary_email: 'student-cohort-del@example.com', role: 'student' });
    const cohort = await makeCohort({ name: 'Student Cohort DELETE' });
    const agent = await loginAs('student-cohort-del@example.com', 'student');
    const res = await agent.delete(`/api/admin/cohorts/${cohort.id}/passphrase`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST — creates passphrase, returns 201 with expected shape
// ---------------------------------------------------------------------------

describe('POST /api/admin/cohorts/:id/passphrase — success', () => {
  it('returns 201 with plaintext and expiresAt ~1h from now', async () => {
    await makeUser({ primary_email: 'admin-cohort-post@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Post Cohort' });
    const agent = await loginAs('admin-cohort-post@example.com', 'admin');

    const before = Date.now();
    const res = await agent
      .post(`/api/admin/cohorts/${cohort.id}/passphrase`)
      .send({ grantLlmProxy: false });

    expect(res.status).toBe(201);
    expect(typeof res.body.plaintext).toBe('string');
    expect(res.body.plaintext.length).toBeGreaterThan(0);
    expect(res.body.grantLlmProxy).toBe(false);

    const expiresAt = new Date(res.body.expiresAt).getTime();
    const expected = before + 60 * 60 * 1000;
    // Allow 5s tolerance
    expect(expiresAt).toBeGreaterThanOrEqual(expected - 5_000);
    expect(expiresAt).toBeLessThanOrEqual(expected + 5_000);
  });

  it('stores grantLlmProxy: true when requested', async () => {
    await makeUser({ primary_email: 'admin-cohort-llm@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'LLM Proxy Cohort' });
    const agent = await loginAs('admin-cohort-llm@example.com', 'admin');

    const res = await agent
      .post(`/api/admin/cohorts/${cohort.id}/passphrase`)
      .send({ grantLlmProxy: true });

    expect(res.status).toBe(201);
    expect(res.body.grantLlmProxy).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST — explicit plaintext
// ---------------------------------------------------------------------------

describe('POST /api/admin/cohorts/:id/passphrase — explicit plaintext', () => {
  it('stores an explicit valid plaintext', async () => {
    await makeUser({ primary_email: 'admin-cohort-explicit@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Explicit Cohort' });
    const agent = await loginAs('admin-cohort-explicit@example.com', 'admin');

    const res = await agent
      .post(`/api/admin/cohorts/${cohort.id}/passphrase`)
      .send({ plaintext: 'apple-banana-cherry', grantLlmProxy: false });

    expect(res.status).toBe(201);
    expect(res.body.plaintext).toBe('apple-banana-cherry');
  });

  it('returns 422 for malformed plaintext', async () => {
    await makeUser({ primary_email: 'admin-cohort-bad@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Bad Plaintext Cohort' });
    const agent = await loginAs('admin-cohort-bad@example.com', 'admin');

    const res = await agent
      .post(`/api/admin/cohorts/${cohort.id}/passphrase`)
      .send({ plaintext: 'NOT VALID!!!', grantLlmProxy: false });

    expect(res.status).toBe(422);
    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST — rotation overwrites old passphrase
// ---------------------------------------------------------------------------

describe('POST /api/admin/cohorts/:id/passphrase — rotation', () => {
  it('overwrites the old passphrase on a second POST', async () => {
    await makeUser({ primary_email: 'admin-cohort-rotate@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Rotate Cohort' });
    const agent = await loginAs('admin-cohort-rotate@example.com', 'admin');

    const first = await agent
      .post(`/api/admin/cohorts/${cohort.id}/passphrase`)
      .send({ plaintext: 'apple-banana-cherry', grantLlmProxy: false });
    expect(first.status).toBe(201);
    const firstPlaintext = first.body.plaintext;

    const second = await agent
      .post(`/api/admin/cohorts/${cohort.id}/passphrase`)
      .send({ plaintext: 'tiger-eagle-river', grantLlmProxy: false });
    expect(second.status).toBe(201);
    expect(second.body.plaintext).toBe('tiger-eagle-river');
    expect(second.body.plaintext).not.toBe(firstPlaintext);

    // Confirm GET returns the new one.
    const get = await agent.get(`/api/admin/cohorts/${cohort.id}/passphrase`);
    expect(get.status).toBe(200);
    expect(get.body.plaintext).toBe('tiger-eagle-river');
  });
});

// ---------------------------------------------------------------------------
// GET — returns active passphrase
// ---------------------------------------------------------------------------

describe('GET /api/admin/cohorts/:id/passphrase', () => {
  it('returns 200 with the active passphrase', async () => {
    await makeUser({ primary_email: 'admin-cohort-get@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Get Cohort' });
    const agent = await loginAs('admin-cohort-get@example.com', 'admin');

    await agent
      .post(`/api/admin/cohorts/${cohort.id}/passphrase`)
      .send({ plaintext: 'tiger-eagle-river', grantLlmProxy: false });

    const res = await agent.get(`/api/admin/cohorts/${cohort.id}/passphrase`);
    expect(res.status).toBe(200);
    expect(res.body.plaintext).toBe('tiger-eagle-river');
    expect(res.body).toHaveProperty('expiresAt');
    expect(res.body).toHaveProperty('grantLlmProxy');
    expect(res.body).toHaveProperty('createdAt');
  });

  it('returns 404 when no active passphrase exists', async () => {
    await makeUser({ primary_email: 'admin-cohort-nopass@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'No Pass Cohort' });
    const agent = await loginAs('admin-cohort-nopass@example.com', 'admin');

    const res = await agent.get(`/api/admin/cohorts/${cohort.id}/passphrase`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE — clears passphrase, idempotent
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/cohorts/:id/passphrase', () => {
  it('returns 204 and subsequent GET returns 404', async () => {
    await makeUser({ primary_email: 'admin-cohort-del2@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Del Cohort' });
    const agent = await loginAs('admin-cohort-del2@example.com', 'admin');

    await agent
      .post(`/api/admin/cohorts/${cohort.id}/passphrase`)
      .send({ grantLlmProxy: false });

    const del = await agent.delete(`/api/admin/cohorts/${cohort.id}/passphrase`);
    expect(del.status).toBe(204);

    const get = await agent.get(`/api/admin/cohorts/${cohort.id}/passphrase`);
    expect(get.status).toBe(404);
  });

  it('returns 204 even when no passphrase exists (idempotent)', async () => {
    await makeUser({ primary_email: 'admin-cohort-del-idem@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Idem Cohort' });
    const agent = await loginAs('admin-cohort-del-idem@example.com', 'admin');

    const res = await agent.delete(`/api/admin/cohorts/${cohort.id}/passphrase`);
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// POST — 404 on missing cohort id
// ---------------------------------------------------------------------------

describe('POST /api/admin/cohorts/:id/passphrase — missing scope', () => {
  it('returns 404 for a non-existent cohort id', async () => {
    await makeUser({ primary_email: 'admin-cohort-miss@example.com', role: 'admin' });
    const agent = await loginAs('admin-cohort-miss@example.com', 'admin');

    const res = await agent
      .post('/api/admin/cohorts/999999/passphrase')
      .send({ grantLlmProxy: false });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// GROUP PASSPHRASE ROUTES
// ===========================================================================

// ---------------------------------------------------------------------------
// 401 — unauthenticated
// ---------------------------------------------------------------------------

describe('Group passphrase routes — unauthenticated (401)', () => {
  it('POST /api/admin/groups/:id/passphrase returns 401 with no session', async () => {
    const group = await makeGroup({ name: 'Auth Group' });
    const res = await request(app)
      .post(`/api/admin/groups/${group.id}/passphrase`)
      .send({ grantLlmProxy: false });
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/groups/:id/passphrase returns 401 with no session', async () => {
    const group = await makeGroup({ name: 'Auth Group GET' });
    const res = await request(app).get(`/api/admin/groups/${group.id}/passphrase`);
    expect(res.status).toBe(401);
  });

  it('DELETE /api/admin/groups/:id/passphrase returns 401 with no session', async () => {
    const group = await makeGroup({ name: 'Auth Group DELETE' });
    const res = await request(app).delete(`/api/admin/groups/${group.id}/passphrase`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 403 — student / staff roles
// ---------------------------------------------------------------------------

describe('Group passphrase routes — non-admin (403)', () => {
  it('POST returns 403 for student', async () => {
    await makeUser({ primary_email: 'student-group@example.com', role: 'student' });
    const group = await makeGroup({ name: 'Student Group' });
    const agent = await loginAs('student-group@example.com', 'student');
    const res = await agent
      .post(`/api/admin/groups/${group.id}/passphrase`)
      .send({ grantLlmProxy: false });
    expect(res.status).toBe(403);
  });

  it('POST returns 403 for staff', async () => {
    await makeUser({ primary_email: 'staff-group@example.com', role: 'staff' });
    const group = await makeGroup({ name: 'Staff Group' });
    const agent = await loginAs('staff-group@example.com', 'staff');
    const res = await agent
      .post(`/api/admin/groups/${group.id}/passphrase`)
      .send({ grantLlmProxy: false });
    expect(res.status).toBe(403);
  });

  it('GET returns 403 for student', async () => {
    await makeUser({ primary_email: 'student-group-get@example.com', role: 'student' });
    const group = await makeGroup({ name: 'Student Group GET' });
    const agent = await loginAs('student-group-get@example.com', 'student');
    const res = await agent.get(`/api/admin/groups/${group.id}/passphrase`);
    expect(res.status).toBe(403);
  });

  it('DELETE returns 403 for student', async () => {
    await makeUser({ primary_email: 'student-group-del@example.com', role: 'student' });
    const group = await makeGroup({ name: 'Student Group DELETE' });
    const agent = await loginAs('student-group-del@example.com', 'student');
    const res = await agent.delete(`/api/admin/groups/${group.id}/passphrase`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST — creates passphrase, returns 201 with expected shape
// ---------------------------------------------------------------------------

describe('POST /api/admin/groups/:id/passphrase — success', () => {
  it('returns 201 with plaintext and expiresAt ~1h from now', async () => {
    await makeUser({ primary_email: 'admin-group-post@example.com', role: 'admin' });
    const group = await makeGroup({ name: 'Post Group' });
    const agent = await loginAs('admin-group-post@example.com', 'admin');

    const before = Date.now();
    const res = await agent
      .post(`/api/admin/groups/${group.id}/passphrase`)
      .send({ grantLlmProxy: false });

    expect(res.status).toBe(201);
    expect(typeof res.body.plaintext).toBe('string');
    expect(res.body.plaintext.length).toBeGreaterThan(0);
    expect(res.body.grantLlmProxy).toBe(false);

    const expiresAt = new Date(res.body.expiresAt).getTime();
    const expected = before + 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(expected - 5_000);
    expect(expiresAt).toBeLessThanOrEqual(expected + 5_000);
  });

  it('stores grantLlmProxy: true when requested', async () => {
    await makeUser({ primary_email: 'admin-group-llm@example.com', role: 'admin' });
    const group = await makeGroup({ name: 'LLM Proxy Group' });
    const agent = await loginAs('admin-group-llm@example.com', 'admin');

    const res = await agent
      .post(`/api/admin/groups/${group.id}/passphrase`)
      .send({ grantLlmProxy: true });

    expect(res.status).toBe(201);
    expect(res.body.grantLlmProxy).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST — explicit plaintext
// ---------------------------------------------------------------------------

describe('POST /api/admin/groups/:id/passphrase — explicit plaintext', () => {
  it('stores an explicit valid plaintext', async () => {
    await makeUser({ primary_email: 'admin-group-explicit@example.com', role: 'admin' });
    const group = await makeGroup({ name: 'Explicit Group' });
    const agent = await loginAs('admin-group-explicit@example.com', 'admin');

    const res = await agent
      .post(`/api/admin/groups/${group.id}/passphrase`)
      .send({ plaintext: 'mango-apple-papaya', grantLlmProxy: false });

    expect(res.status).toBe(201);
    expect(res.body.plaintext).toBe('mango-apple-papaya');
  });

  it('returns 422 for malformed plaintext', async () => {
    await makeUser({ primary_email: 'admin-group-bad@example.com', role: 'admin' });
    const group = await makeGroup({ name: 'Bad Plaintext Group' });
    const agent = await loginAs('admin-group-bad@example.com', 'admin');

    const res = await agent
      .post(`/api/admin/groups/${group.id}/passphrase`)
      .send({ plaintext: 'INVALID PASSPHRASE 123!!!', grantLlmProxy: false });

    expect(res.status).toBe(422);
    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST — rotation overwrites old passphrase
// ---------------------------------------------------------------------------

describe('POST /api/admin/groups/:id/passphrase — rotation', () => {
  it('overwrites the old passphrase on a second POST', async () => {
    await makeUser({ primary_email: 'admin-group-rotate@example.com', role: 'admin' });
    const group = await makeGroup({ name: 'Rotate Group' });
    const agent = await loginAs('admin-group-rotate@example.com', 'admin');

    const first = await agent
      .post(`/api/admin/groups/${group.id}/passphrase`)
      .send({ plaintext: 'ocean-wave-shore', grantLlmProxy: false });
    expect(first.status).toBe(201);

    const second = await agent
      .post(`/api/admin/groups/${group.id}/passphrase`)
      .send({ plaintext: 'mountain-river-sky', grantLlmProxy: false });
    expect(second.status).toBe(201);
    expect(second.body.plaintext).toBe('mountain-river-sky');

    const get = await agent.get(`/api/admin/groups/${group.id}/passphrase`);
    expect(get.status).toBe(200);
    expect(get.body.plaintext).toBe('mountain-river-sky');
  });
});

// ---------------------------------------------------------------------------
// GET — returns active passphrase
// ---------------------------------------------------------------------------

describe('GET /api/admin/groups/:id/passphrase', () => {
  it('returns 200 with the active passphrase', async () => {
    await makeUser({ primary_email: 'admin-group-get2@example.com', role: 'admin' });
    const group = await makeGroup({ name: 'Get Group' });
    const agent = await loginAs('admin-group-get2@example.com', 'admin');

    await agent
      .post(`/api/admin/groups/${group.id}/passphrase`)
      .send({ plaintext: 'forest-brook-stone', grantLlmProxy: true });

    const res = await agent.get(`/api/admin/groups/${group.id}/passphrase`);
    expect(res.status).toBe(200);
    expect(res.body.plaintext).toBe('forest-brook-stone');
    expect(res.body.grantLlmProxy).toBe(true);
    expect(res.body).toHaveProperty('expiresAt');
    expect(res.body).toHaveProperty('createdAt');
  });

  it('returns 404 when no active passphrase exists', async () => {
    await makeUser({ primary_email: 'admin-group-nopass@example.com', role: 'admin' });
    const group = await makeGroup({ name: 'No Pass Group' });
    const agent = await loginAs('admin-group-nopass@example.com', 'admin');

    const res = await agent.get(`/api/admin/groups/${group.id}/passphrase`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE — clears passphrase, idempotent
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/groups/:id/passphrase', () => {
  it('returns 204 and subsequent GET returns 404', async () => {
    await makeUser({ primary_email: 'admin-group-del2@example.com', role: 'admin' });
    const group = await makeGroup({ name: 'Del Group' });
    const agent = await loginAs('admin-group-del2@example.com', 'admin');

    await agent
      .post(`/api/admin/groups/${group.id}/passphrase`)
      .send({ grantLlmProxy: false });

    const del = await agent.delete(`/api/admin/groups/${group.id}/passphrase`);
    expect(del.status).toBe(204);

    const get = await agent.get(`/api/admin/groups/${group.id}/passphrase`);
    expect(get.status).toBe(404);
  });

  it('returns 204 even when no passphrase exists (idempotent)', async () => {
    await makeUser({ primary_email: 'admin-group-del-idem@example.com', role: 'admin' });
    const group = await makeGroup({ name: 'Idem Group' });
    const agent = await loginAs('admin-group-del-idem@example.com', 'admin');

    const res = await agent.delete(`/api/admin/groups/${group.id}/passphrase`);
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// POST — 404 on missing group id
// ---------------------------------------------------------------------------

describe('POST /api/admin/groups/:id/passphrase — missing scope', () => {
  it('returns 404 for a non-existent group id', async () => {
    await makeUser({ primary_email: 'admin-group-miss@example.com', role: 'admin' });
    const agent = await loginAs('admin-group-miss@example.com', 'admin');

    const res = await agent
      .post('/api/admin/groups/999999/passphrase')
      .send({ grantLlmProxy: false });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// CROSS-SCOPE: cohort A and group B are independent
// ===========================================================================

describe('Cross-scope isolation', () => {
  it('revoking cohort passphrase does not affect group passphrase', async () => {
    await makeUser({ primary_email: 'admin-cross@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Cross Cohort' });
    const group = await makeGroup({ name: 'Cross Group' });
    const agent = await loginAs('admin-cross@example.com', 'admin');

    // Create passphrase on both.
    const cohortPost = await agent
      .post(`/api/admin/cohorts/${cohort.id}/passphrase`)
      .send({ plaintext: 'forest-brook-stone', grantLlmProxy: false });
    expect(cohortPost.status).toBe(201);

    const groupPost = await agent
      .post(`/api/admin/groups/${group.id}/passphrase`)
      .send({ plaintext: 'ocean-wave-shore', grantLlmProxy: false });
    expect(groupPost.status).toBe(201);

    // Revoke cohort passphrase.
    const del = await agent.delete(`/api/admin/cohorts/${cohort.id}/passphrase`);
    expect(del.status).toBe(204);

    // Cohort passphrase is gone.
    const cohortGet = await agent.get(`/api/admin/cohorts/${cohort.id}/passphrase`);
    expect(cohortGet.status).toBe(404);

    // Group passphrase is still present.
    const groupGet = await agent.get(`/api/admin/groups/${group.id}/passphrase`);
    expect(groupGet.status).toBe(200);
    expect(groupGet.body.plaintext).toBe('ocean-wave-shore');
  });
});
