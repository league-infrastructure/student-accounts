/**
 * Integration tests for the LLM proxy grant permission gate (Sprint 026 T004).
 *
 * Verifies:
 *  - Single grant returns 403 when target user has no group with allows_llm_proxy.
 *  - Single grant returns 201 when target user is in a group with allows_llm_proxy.
 *  - Bulk grant skips users without allows_llm_proxy and grants those with it.
 *  - Existing active tokens are NOT revoked when a group's allows_llm_proxy is toggled off.
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

describe('POST /api/admin/users/:id/llm-proxy-token — permission gate', () => {
  it('403 when target user has no group with allows_llm_proxy', async () => {
    const target = await makeUser({ role: 'student' });
    // Group WITHOUT the flag.
    const group = await makeGroup({ allows_llm_proxy: false });
    await makeMembership(group, target);

    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 1000 });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('allowsLlmProxy');
  });

  it('403 when target user belongs to no groups at all', async () => {
    const target = await makeUser({ role: 'student' });
    // No group memberships.

    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 1000 });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('allowsLlmProxy');
  });

  it('201 when target user is in a group with allows_llm_proxy=true', async () => {
    const target = await makeUser({ role: 'student' });
    const group = await makeGroup({ allows_llm_proxy: true });
    await makeMembership(group, target);

    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 1_000_000 });

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.startsWith('llmp_')).toBe(true);
  });

  it('201 via multi-group union: one group has flag, another does not', async () => {
    const target = await makeUser({ role: 'student' });
    const noPermGroup = await makeGroup({ allows_llm_proxy: false });
    const permGroup = await makeGroup({ allows_llm_proxy: true });
    await makeMembership(noPermGroup, target);
    await makeMembership(permGroup, target);

    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 500 });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Bulk grant — POST /api/admin/groups/:id/llm-proxy/bulk-grant
// ---------------------------------------------------------------------------

describe('POST /api/admin/groups/:id/llm-proxy/bulk-grant — permission gate', () => {
  it('grants tokens to eligible members and skips ineligible ones', async () => {
    /**
     * Setup:
     *   grantGroup  (allows_llm_proxy=false) — the group we bulk-grant from
     *   permGroup   (allows_llm_proxy=true)  — grants permission
     *
     *   eligible:   member of grantGroup AND permGroup → llmProxy=true → gets token
     *   ineligible: member of grantGroup only          → llmProxy=false → skipped
     */
    const grantGroup = await makeGroup({ allows_llm_proxy: false });
    const permGroup = await makeGroup({ allows_llm_proxy: true });

    const eligible = await makeUser({ role: 'student' });
    const ineligible = await makeUser({ role: 'student' });

    await makeMembership(grantGroup, eligible);
    await makeMembership(permGroup, eligible);

    await makeMembership(grantGroup, ineligible);
    // ineligible is NOT in permGroup — only in grantGroup which has no flag.

    const res = await adminAgent
      .post(`/api/admin/groups/${grantGroup.id}/llm-proxy/bulk-grant`)
      .send({ expiresAt: futureIso(), tokenLimit: 500 });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toContain(eligible.id);
    expect(res.body.skipped).toContain(ineligible.id);
    // skippedReasons should indicate no_permission for the ineligible user.
    expect(res.body.skippedReasons?.[String(ineligible.id)]).toBe('no_permission');
    // Ineligible user should NOT have a token.
    const ineligibleToken = await (prisma as any).llmProxyToken.findFirst({
      where: { user_id: ineligible.id },
    });
    expect(ineligibleToken).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No-revoke invariant — toggling allows_llm_proxy off does NOT revoke tokens
// ---------------------------------------------------------------------------

describe('allows_llm_proxy toggle — no revocation of existing tokens', () => {
  it('existing active token remains valid after allows_llm_proxy is toggled off', async () => {
    const user = await makeUser({ role: 'student' });
    const group = await makeGroup({ allows_llm_proxy: true });
    await makeMembership(group, user);

    // Grant a token while the group has the flag.
    const grantRes = await adminAgent
      .post(`/api/admin/users/${user.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 100 });
    expect(grantRes.status).toBe(201);
    const tokenId: number = grantRes.body.tokenId;

    // Toggle the flag off directly in the DB (simulating an admin update).
    await (prisma as any).group.update({
      where: { id: group.id },
      data: { allows_llm_proxy: false },
    });

    // The existing token row should still be active (revoked_at is null).
    const row = await (prisma as any).llmProxyToken.findUnique({ where: { id: tokenId } });
    expect(row).not.toBeNull();
    expect(row.revoked_at).toBeNull();
  });

  it('new grant for the same user is 403 after allows_llm_proxy is toggled off', async () => {
    const user = await makeUser({ role: 'student' });
    const group = await makeGroup({ allows_llm_proxy: true });
    await makeMembership(group, user);

    // Grant a token while the group has the flag.
    await adminAgent
      .post(`/api/admin/users/${user.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 100 })
      .expect(201);

    // Toggle the flag off.
    await (prisma as any).group.update({
      where: { id: group.id },
      data: { allows_llm_proxy: false },
    });

    // Revoke the existing token so we can test the new-grant gate without hitting 409.
    await adminAgent.delete(`/api/admin/users/${user.id}/llm-proxy-token`).expect(204);

    // New grant attempt should now be 403.
    const newGrantRes = await adminAgent
      .post(`/api/admin/users/${user.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 100 });
    expect(newGrantRes.status).toBe(403);
    expect(newGrantRes.body.error).toContain('allowsLlmProxy');
  });
});
