/**
 * Integration tests for the admin bulk LLM-proxy routes (Sprint 013 T007).
 *
 * Verifies:
 *  - 200 + { succeeded, failed, skipped, tokensByUser? } on happy path.
 *  - 404 when the cohort / group doesn't exist.
 *  - 400 on bad expiresAt / tokenLimit.
 *  - 401 unauthenticated.
 *  - Parallel coverage for cohort and group scopes.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';
import { makeUser, makeCohort, makeGroup, makeMembership } from './helpers/factories';

let adminAgent: ReturnType<typeof request.agent>;
let adminUserId: number;

beforeAll(async () => {
  adminAgent = request.agent(app);
  await adminAgent
    .post('/api/auth/test-login')
    .send({
      email: 'admin-bulk-llm@example.com',
      displayName: 'Admin Bulk LLM',
      role: 'ADMIN',
    })
    .expect(200);
  const admin = await prisma.user.findFirst({
    where: { primary_email: 'admin-bulk-llm@example.com' },
  });
  adminUserId = admin!.id;
}, 30000);

async function wipeExceptAdmin() {
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany({ where: { user_id: { not: adminUserId } } });
  await (prisma as any).user.deleteMany({ where: { id: { not: adminUserId } } });
  await (prisma as any).cohort.deleteMany();
}

beforeEach(async () => {
  await wipeExceptAdmin();
});

afterEach(async () => {
  await wipeExceptAdmin();
});

function futureIso(daysAhead = 30): string {
  return new Date(Date.now() + daysAhead * 24 * 3600 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// POST /api/admin/cohorts/:id/llm-proxy/bulk-grant
// ---------------------------------------------------------------------------

describe('POST /api/admin/cohorts/:id/llm-proxy/bulk-grant', () => {
  it('200 with succeeded + tokensByUser for a cohort with active students', async () => {
    const cohort = await makeCohort();
    const u1 = await makeUser({ role: 'student', cohort_id: cohort.id });
    const u2 = await makeUser({ role: 'student', cohort_id: cohort.id });

    const res = await adminAgent
      .post(`/api/admin/cohorts/${cohort.id}/llm-proxy/bulk-grant`)
      .send({ expiresAt: futureIso(), tokenLimit: 10_000 });

    expect(res.status).toBe(200);
    expect(res.body.succeeded.sort()).toEqual([u1.id, u2.id].sort());
    expect(Object.keys(res.body.tokensByUser).length).toBe(2);
    for (const uid of res.body.succeeded) {
      expect(res.body.tokensByUser[uid].startsWith('llmp_')).toBe(true);
    }
  });

  it('404 when the cohort does not exist', async () => {
    const res = await adminAgent
      .post('/api/admin/cohorts/9999999/llm-proxy/bulk-grant')
      .send({ expiresAt: futureIso(), tokenLimit: 1000 });
    expect(res.status).toBe(404);
  });

  it('400 on past expiresAt', async () => {
    const cohort = await makeCohort();
    const res = await adminAgent
      .post(`/api/admin/cohorts/${cohort.id}/llm-proxy/bulk-grant`)
      .send({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        tokenLimit: 1000,
      });
    expect(res.status).toBe(400);
  });

  it('400 on zero tokenLimit', async () => {
    const cohort = await makeCohort();
    const res = await adminAgent
      .post(`/api/admin/cohorts/${cohort.id}/llm-proxy/bulk-grant`)
      .send({ expiresAt: futureIso(), tokenLimit: 0 });
    expect(res.status).toBe(400);
  });

  it('401 unauthenticated', async () => {
    const res = await request(app)
      .post('/api/admin/cohorts/1/llm-proxy/bulk-grant')
      .send({ expiresAt: futureIso(), tokenLimit: 1000 });
    expect(res.status).toBe(401);
  });

  it('skipped includes users who already had an active token', async () => {
    const cohort = await makeCohort();
    const u1 = await makeUser({ role: 'student', cohort_id: cohort.id });
    const u2 = await makeUser({ role: 'student', cohort_id: cohort.id });
    // Grant u1 first.
    const actor = await makeUser({ role: 'admin' });
    await registry.llmProxyTokens.grant(
      u1.id,
      { expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000), tokenLimit: 100 },
      actor.id,
    );
    const res = await adminAgent
      .post(`/api/admin/cohorts/${cohort.id}/llm-proxy/bulk-grant`)
      .send({ expiresAt: futureIso(), tokenLimit: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.skipped).toEqual([u1.id]);
    expect(res.body.succeeded).toEqual([u2.id]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/cohorts/:id/llm-proxy/bulk-revoke
// ---------------------------------------------------------------------------

describe('POST /api/admin/cohorts/:id/llm-proxy/bulk-revoke', () => {
  it('200 revokes every active token and reports skipped for users with none', async () => {
    const cohort = await makeCohort();
    const u1 = await makeUser({ role: 'student', cohort_id: cohort.id });
    const u2 = await makeUser({ role: 'student', cohort_id: cohort.id });
    const u3 = await makeUser({ role: 'student', cohort_id: cohort.id });
    const actor = await makeUser({ role: 'admin' });
    await registry.llmProxyTokens.grant(
      u1.id,
      { expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000), tokenLimit: 100 },
      actor.id,
    );
    await registry.llmProxyTokens.grant(
      u2.id,
      { expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000), tokenLimit: 100 },
      actor.id,
    );

    const res = await adminAgent.post(
      `/api/admin/cohorts/${cohort.id}/llm-proxy/bulk-revoke`,
    );
    expect(res.status).toBe(200);
    expect(res.body.succeeded.sort()).toEqual([u1.id, u2.id].sort());
    expect(res.body.skipped).toEqual([u3.id]);
  });

  it('404 when the cohort does not exist', async () => {
    const res = await adminAgent.post(
      '/api/admin/cohorts/9999999/llm-proxy/bulk-revoke',
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Group bulk routes
// ---------------------------------------------------------------------------

describe('POST /api/admin/groups/:id/llm-proxy/bulk-grant', () => {
  it('200 with succeeded + tokensByUser for a group with active members', async () => {
    const group = await makeGroup();
    const u1 = await makeUser({ role: 'student' });
    const u2 = await makeUser({ role: 'student' });
    await makeMembership(group, u1);
    await makeMembership(group, u2);

    const res = await adminAgent
      .post(`/api/admin/groups/${group.id}/llm-proxy/bulk-grant`)
      .send({ expiresAt: futureIso(), tokenLimit: 500 });

    expect(res.status).toBe(200);
    expect(res.body.succeeded.sort()).toEqual([u1.id, u2.id].sort());
  });

  it('404 when the group does not exist', async () => {
    const res = await adminAgent
      .post('/api/admin/groups/9999999/llm-proxy/bulk-grant')
      .send({ expiresAt: futureIso(), tokenLimit: 1000 });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/groups/:id/llm-proxy/bulk-revoke', () => {
  it('200 revokes for group members only', async () => {
    const group = await makeGroup();
    const inside = await makeUser({ role: 'student' });
    const outside = await makeUser({ role: 'student' });
    await makeMembership(group, inside);
    const actor = await makeUser({ role: 'admin' });
    await registry.llmProxyTokens.grant(
      inside.id,
      { expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000), tokenLimit: 100 },
      actor.id,
    );
    await registry.llmProxyTokens.grant(
      outside.id,
      { expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000), tokenLimit: 100 },
      actor.id,
    );
    const res = await adminAgent.post(
      `/api/admin/groups/${group.id}/llm-proxy/bulk-revoke`,
    );
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual([inside.id]);
    // Outside-of-group user's token still active.
    const outsideRow = await (prisma as any).llmProxyToken.findFirst({
      where: { user_id: outside.id },
    });
    expect(outsideRow.revoked_at).toBeNull();
  });
});
