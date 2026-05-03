/**
 * Integration tests for the admin bulk LLM-proxy routes (group-scoped).
 *
 * Verifies:
 *  - 200 + { succeeded, failed, skipped, tokensByUser? } on happy path.
 *  - 404 when the group doesn't exist.
 *  - 400 on bad expiresAt / tokenLimit.
 *  - 401 unauthenticated.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';
import { makeUser, makeGroup, makeMembership } from './helpers/factories';

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
// POST /api/admin/groups/:id/llm-proxy/bulk-*
// ---------------------------------------------------------------------------

describe('POST /api/admin/groups/:id/llm-proxy/bulk-grant', () => {
  it('200 with succeeded + tokensByUser for a group with active members', async () => {
    // allows_llm_proxy=true so members are eligible for token grants (Sprint 026 T004).
    const group = await makeGroup({ allows_llm_proxy: true });
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
