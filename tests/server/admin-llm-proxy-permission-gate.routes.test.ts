/**
 * Integration tests for LLM proxy grant behavior.
 *
 * After removing the permission gate, admins can grant LLM proxy access to any user
 * regardless of the allows_llm_proxy flag on the user or group. The flag is now
 * informational only and does not gate grants.
 *
 * Verifies:
 *  - Single grant returns 201 regardless of allows_llm_proxy flag.
 *  - Bulk grant grants tokens to all eligible members.
 *  - Existing active tokens are NOT revoked when a user's allows_llm_proxy is toggled off.
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
      email: 'admin-llm-gate@example.com',
      displayName: 'Admin LLM Gate',
      role: 'ADMIN',
    })
    .expect(200);
  const admin = await prisma.user.findFirst({
    where: { primary_email: 'admin-llm-gate@example.com' },
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
// Single grant — POST /api/admin/users/:id/llm-proxy-token
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/llm-proxy-token', () => {
  it('201 when target user has allows_llm_proxy=false', async () => {
    const target = await makeUser({ role: 'student' });
    // allows_llm_proxy defaults to false, but grant should still succeed.

    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 1000 });

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.startsWith('llmp_')).toBe(true);
  });

  it('201 when target user has no explicit permission (default false)', async () => {
    const target = await makeUser({ role: 'student' });

    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 1000 });

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
  });

  it('201 when target user has allows_llm_proxy=true', async () => {
    const target = await makeUser({ role: 'student', allows_llm_proxy: true });

    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 1_000_000 });

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.startsWith('llmp_')).toBe(true);
  });

  it('201 when target user has allows_llm_proxy=true (group membership irrelevant)', async () => {
    // Group membership no longer determines permission — only User row matters.
    const target = await makeUser({ role: 'student', allows_llm_proxy: true });
    const group = await makeGroup();
    await makeMembership(group, target);

    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 500 });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Bulk grant — POST /api/admin/groups/:id/llm-proxy/bulk-grant
// ---------------------------------------------------------------------------

describe('POST /api/admin/groups/:id/llm-proxy/bulk-grant', () => {
  it('grants tokens to all eligible members', async () => {
    /**
     * Setup:
     *   grantGroup — the group we bulk-grant from
     *
     *   member1: member of grantGroup → gets token
     *   member2: member of grantGroup → gets token
     */
    const grantGroup = await makeGroup();

    const member1 = await makeUser({ role: 'student', allows_llm_proxy: true });
    const member2 = await makeUser({ role: 'student' });

    await makeMembership(grantGroup, member1);
    await makeMembership(grantGroup, member2);

    const res = await adminAgent
      .post(`/api/admin/groups/${grantGroup.id}/llm-proxy/bulk-grant`)
      .send({ expiresAt: futureIso(), tokenLimit: 500 });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toContain(member1.id);
    expect(res.body.succeeded).toContain(member2.id);
    expect(res.body.skipped).not.toContain(member1.id);
    expect(res.body.skipped).not.toContain(member2.id);
    
    // Both users should have tokens.
    const token1 = await (prisma as any).llmProxyToken.findFirst({
      where: { user_id: member1.id },
    });
    const token2 = await (prisma as any).llmProxyToken.findFirst({
      where: { user_id: member2.id },
    });
    expect(token1).not.toBeNull();
    expect(token2).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No-revoke invariant — toggling allows_llm_proxy off does NOT revoke tokens
// ---------------------------------------------------------------------------

describe('allows_llm_proxy toggle — no revocation of existing tokens', () => {
  it('existing active token remains valid after allows_llm_proxy is toggled off', async () => {
    const user = await makeUser({ role: 'student', allows_llm_proxy: true });

    // Grant a token while the user has the flag.
    const grantRes = await adminAgent
      .post(`/api/admin/users/${user.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 100 });
    expect(grantRes.status).toBe(201);
    const tokenId: number = grantRes.body.tokenId;

    // Toggle the flag off directly in the DB (simulating an admin update).
    await (prisma as any).user.update({
      where: { id: user.id },
      data: { allows_llm_proxy: false },
    });

    // The existing token row should still be active (revoked_at is null).
    const row = await (prisma as any).llmProxyToken.findUnique({ where: { id: tokenId } });
    expect(row).not.toBeNull();
    expect(row.revoked_at).toBeNull();
  });

  it('new grant for the same user succeeds even after allows_llm_proxy is toggled off', async () => {
    const user = await makeUser({ role: 'student', allows_llm_proxy: true });

    // Grant a token while the user has the flag.
    await adminAgent
      .post(`/api/admin/users/${user.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 100 })
      .expect(201);

    // Toggle the flag off.
    await (prisma as any).user.update({
      where: { id: user.id },
      data: { allows_llm_proxy: false },
    });

    // Revoke the existing token so we can test the new-grant gate without hitting 409.
    await adminAgent.delete(`/api/admin/users/${user.id}/llm-proxy-token`).expect(204);

    // New grant attempt should still succeed — permission gate has been removed.
    const newGrantRes = await adminAgent
      .post(`/api/admin/users/${user.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 100 });
    expect(newGrantRes.status).toBe(201);
    expect(typeof newGrantRes.body.token).toBe('string');
  });
});
