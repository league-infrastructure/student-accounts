/**
 * Integration tests for the admin "users views" endpoints:
 *   GET  /api/admin/users/with-llm-proxy
 *   POST /api/admin/users/bulk-suspend-accounts
 *   POST /api/admin/users/bulk-revoke-llm-proxy
 *
 * Coverage:
 *  - Auth gates (401 unauthenticated, 403 non-admin).
 *  - /with-llm-proxy returns only rows with active tokens + live users.
 *  - bulk-suspend-accounts suspends active workspace/claude accounts and
 *    reports success/failure per account.
 *  - bulk-revoke-llm-proxy revokes active tokens and skips users without
 *    one.
 *  - Request validation (bad/empty userIds → 400).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../../server/src/app';
import { prisma } from '../../../server/src/services/prisma';
import { makeUser, makeExternalAccount } from '../helpers/factories';
import { FakeGoogleWorkspaceAdminClient } from '../helpers/fake-google-workspace-admin.client';
import { FakeClaudeTeamAdminClient } from '../helpers/fake-claude-team-admin.client';
import { ExternalAccountLifecycleService } from '../../../server/src/services/external-account-lifecycle.service';
import { AuditService } from '../../../server/src/services/audit.service';
import { ExternalAccountRepository } from '../../../server/src/services/repositories/external-account.repository';

process.env.NODE_ENV = 'test';

let adminAgent: ReturnType<typeof request.agent>;
let adminUserId: number;
let restoreLifecycle: () => void = () => {};

beforeAll(async () => {
  adminAgent = request.agent(app);
  await adminAgent
    .post('/api/auth/test-login')
    .send({
      email: 'admin-users-views@example.com',
      displayName: 'Admin Users Views',
      role: 'ADMIN',
    })
    .expect(200);
  const admin = await prisma.user.findFirst({
    where: { primary_email: 'admin-users-views@example.com' },
  });
  adminUserId = admin!.id;

  // Inject fake Google/Claude clients so suspend lifecycle calls don't
  // fail against unconfigured external APIs.
  const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
  const fakeClaude = new FakeClaudeTeamAdminClient();
  const originalLifecycle = (registry as any).externalAccountLifecycle;
  (registry as any).externalAccountLifecycle = new ExternalAccountLifecycleService(
    fakeGoogle,
    fakeClaude,
    ExternalAccountRepository,
    new AuditService(),
  );
  restoreLifecycle = () => {
    (registry as any).externalAccountLifecycle = originalLifecycle;
  };
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

afterAll(async () => {
  await wipeExceptAdmin();
  restoreLifecycle();
});

function futureDate(days = 30): Date {
  return new Date(Date.now() + days * 24 * 3600 * 1000);
}

// ---------------------------------------------------------------------------
// GET /api/admin/users/with-llm-proxy
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/with-llm-proxy', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/admin/users/with-llm-proxy');
    expect(res.status).toBe(401);
  });

  it('returns only users with active non-expired tokens', async () => {
    const u1 = await makeUser({ role: 'student', primary_email: 'u1@s.jointheleague.org' });
    const u2 = await makeUser({ role: 'student', primary_email: 'u2@s.jointheleague.org' });
    const u3 = await makeUser({ role: 'student', primary_email: 'u3@s.jointheleague.org' });

    // u1: active token (should be returned)
    await registry.llmProxyTokens.grant(
      u1.id,
      { expiresAt: futureDate(), tokenLimit: 1000 },
      adminUserId,
    );
    // u2: token then revoked (should NOT be returned)
    await registry.llmProxyTokens.grant(
      u2.id,
      { expiresAt: futureDate(), tokenLimit: 1000 },
      adminUserId,
    );
    await registry.llmProxyTokens.revoke(u2.id, adminUserId);
    // u3: no token (should NOT be returned)

    const res = await adminAgent.get('/api/admin/users/with-llm-proxy');
    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((r) => r.userId);
    expect(ids).toEqual([u1.id]);
    expect(res.body[0]).toMatchObject({
      userId: u1.id,
      email: 'u1@s.jointheleague.org',
      tokenLimit: 1000,
    });
  });

  it('excludes users whose is_active = false', async () => {
    const u = await makeUser({ role: 'student' });
    await registry.llmProxyTokens.grant(
      u.id,
      { expiresAt: futureDate(), tokenLimit: 1000 },
      adminUserId,
    );
    await (prisma as any).user.update({ where: { id: u.id }, data: { is_active: false } });

    const res = await adminAgent.get('/api/admin/users/with-llm-proxy');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/bulk-suspend-accounts
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/bulk-suspend-accounts', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/admin/users/bulk-suspend-accounts')
      .send({ userIds: [1] });
    expect(res.status).toBe(401);
  });

  it('returns 400 on empty or malformed userIds', async () => {
    const empty = await adminAgent
      .post('/api/admin/users/bulk-suspend-accounts')
      .send({ userIds: [] });
    expect(empty.status).toBe(400);

    const bad = await adminAgent
      .post('/api/admin/users/bulk-suspend-accounts')
      .send({ userIds: ['oops'] });
    expect(bad.status).toBe(400);

    const missing = await adminAgent.post('/api/admin/users/bulk-suspend-accounts').send({});
    expect(missing.status).toBe(400);
  });

  it('suspends active workspace + claude accounts for the given users', async () => {
    const u1 = await makeUser({ role: 'student' });
    const u2 = await makeUser({ role: 'student' });
    const a1 = await makeExternalAccount(u1, { type: 'workspace', status: 'active' });
    const a2 = await makeExternalAccount(u1, { type: 'claude', status: 'active' });
    const a3 = await makeExternalAccount(u2, { type: 'workspace', status: 'active' });

    const res = await adminAgent
      .post('/api/admin/users/bulk-suspend-accounts')
      .send({ userIds: [u1.id, u2.id] });

    expect([200, 207]).toContain(res.status);
    expect(res.body.succeeded.sort()).toEqual([a1.id, a2.id, a3.id].sort());
    expect(res.body.failed).toEqual([]);

    const rows = await (prisma as any).externalAccount.findMany({
      where: { id: { in: [a1.id, a2.id, a3.id] } },
      orderBy: { id: 'asc' },
    });
    for (const r of rows) expect(r.status).toBe('suspended');
  });

  it('ignores accounts that are already removed or suspended', async () => {
    const u = await makeUser({ role: 'student' });
    await makeExternalAccount(u, { type: 'workspace', status: 'removed' });
    await makeExternalAccount(u, { type: 'claude', status: 'suspended' });

    const res = await adminAgent
      .post('/api/admin/users/bulk-suspend-accounts')
      .send({ userIds: [u.id] });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual([]);
    expect(res.body.totalEligible).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/bulk-revoke-llm-proxy
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/bulk-revoke-llm-proxy', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/admin/users/bulk-revoke-llm-proxy')
      .send({ userIds: [1] });
    expect(res.status).toBe(401);
  });

  it('returns 400 on empty userIds', async () => {
    const res = await adminAgent
      .post('/api/admin/users/bulk-revoke-llm-proxy')
      .send({ userIds: [] });
    expect(res.status).toBe(400);
  });

  it('revokes tokens for users who have them and skips those who do not', async () => {
    const u1 = await makeUser({ role: 'student' });
    const u2 = await makeUser({ role: 'student' });
    const u3 = await makeUser({ role: 'student' });
    await registry.llmProxyTokens.grant(
      u1.id,
      { expiresAt: futureDate(), tokenLimit: 1000 },
      adminUserId,
    );
    await registry.llmProxyTokens.grant(
      u2.id,
      { expiresAt: futureDate(), tokenLimit: 1000 },
      adminUserId,
    );
    // u3: no token

    const res = await adminAgent
      .post('/api/admin/users/bulk-revoke-llm-proxy')
      .send({ userIds: [u1.id, u2.id, u3.id] });

    expect(res.status).toBe(200);
    expect(res.body.succeeded.sort()).toEqual([u1.id, u2.id].sort());
    expect(res.body.skipped).toEqual([u3.id]);
    expect(res.body.failed).toEqual([]);

    // The tokens are gone from the active-for-user view.
    const still1 = await registry.llmProxyTokens.getActiveForUser(u1.id);
    const still2 = await registry.llmProxyTokens.getActiveForUser(u2.id);
    expect(still1).toBeNull();
    expect(still2).toBeNull();
  });
});
