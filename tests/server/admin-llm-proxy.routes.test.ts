/**
 * Integration tests for admin LLM-proxy routes (Sprint 013 T005).
 *
 * Runs against the real Prisma client — no service fakes so the
 * plaintext-once and audit invariants are verified end-to-end.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';
import { makeUser, makeGroup, makeMembership } from './helpers/factories';

let adminAgent: ReturnType<typeof request.agent>;
let adminUserId: number;

beforeAll(async () => {
  adminAgent = request.agent(app);
  await adminAgent
    .post('/api/auth/test-login')
    .send({
      email: 'admin-llm-proxy@example.com',
      displayName: 'Admin LLM Proxy',
      role: 'ADMIN',
    })
    .expect(200);
  const admin = await prisma.user.findFirst({
    where: { primary_email: 'admin-llm-proxy@example.com' },
  });
  adminUserId = admin!.id;
}, 30000);

// Clean users (and their dependent rows) between tests so the module-level
// `_seq` counter in factories.ts doesn't collide with leftover rows from
// other test files. Sparing only the persistent admin fixture we created
// in beforeAll — without it the shared admin agent loses its backing user.
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

// Helpers -----------------------------------------------------------------

/** Create a user pre-enrolled in an llm-proxy-enabled group. */
async function makeEligibleUser(opts: { role?: 'student' | 'staff' | 'admin' } = {}) {
  const user = await makeUser({ role: opts.role ?? 'student' });
  const group = await makeGroup({ allows_llm_proxy: true });
  await makeMembership(group, user);
  return user;
}

function futureIso(daysAhead = 30): string {
  return new Date(Date.now() + daysAhead * 24 * 3600 * 1000).toISOString();
}

function pastIso(): string {
  return new Date(Date.now() - 24 * 3600 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/llm-proxy-token
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/llm-proxy-token', () => {
  it('201 creates a token and returns plaintext once', async () => {
    const target = await makeEligibleUser({ role: 'student' });
    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 1_000_000 });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.startsWith('llmp_')).toBe(true);
    expect(res.body.tokenLimit).toBe(1_000_000);
    expect(typeof res.body.tokenId).toBe('number');
    // Persisted row exists.
    const row = await (prisma as any).llmProxyToken.findUnique({
      where: { id: res.body.tokenId },
    });
    expect(row.user_id).toBe(target.id);
    expect(row.granted_by).toBe(adminUserId);
  });

  it('400 when expiresAt is in the past', async () => {
    const target = await makeUser({ role: 'student' });
    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: pastIso(), tokenLimit: 1000 });
    expect(res.status).toBe(400);
  });

  it('400 when expiresAt is malformed', async () => {
    const target = await makeUser({ role: 'student' });
    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: 'not-a-date', tokenLimit: 1000 });
    expect(res.status).toBe(400);
  });

  it('400 when tokenLimit is zero', async () => {
    const target = await makeUser({ role: 'student' });
    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 0 });
    expect(res.status).toBe(400);
  });

  it('400 when tokenLimit is negative', async () => {
    const target = await makeUser({ role: 'student' });
    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: -5 });
    expect(res.status).toBe(400);
  });

  it('404 when the user does not exist', async () => {
    const res = await adminAgent
      .post('/api/admin/users/999999/llm-proxy-token')
      .send({ expiresAt: futureIso(), tokenLimit: 1000 });
    expect(res.status).toBe(404);
  });

  it('409 when the user already has an active token', async () => {
    const target = await makeEligibleUser({ role: 'student' });
    await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 1000 })
      .expect(201);
    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 1000 });
    expect(res.status).toBe(409);
  });

  it('401 unauthenticated', async () => {
    const target = await makeUser({ role: 'student' });
    const res = await request(app)
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 1000 });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/:id/llm-proxy-token
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/users/:id/llm-proxy-token', () => {
  it('204 when there is an active token', async () => {
    const target = await makeEligibleUser({ role: 'student' });
    await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 1000 })
      .expect(201);
    const res = await adminAgent.delete(
      `/api/admin/users/${target.id}/llm-proxy-token`,
    );
    expect(res.status).toBe(204);
    // Token should now have revoked_at set.
    const rows = await (prisma as any).llmProxyToken.findMany({
      where: { user_id: target.id },
    });
    expect(rows[0].revoked_at).not.toBeNull();
  });

  it('404 when there is no active token', async () => {
    const target = await makeUser({ role: 'student' });
    const res = await adminAgent.delete(
      `/api/admin/users/${target.id}/llm-proxy-token`,
    );
    expect(res.status).toBe(404);
  });

  it('404 when the user does not exist', async () => {
    const res = await adminAgent.delete('/api/admin/users/9999999/llm-proxy-token');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/users/:id/llm-proxy-token
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id/llm-proxy-token', () => {
  it('returns { enabled: false } when no active token', async () => {
    const target = await makeUser({ role: 'student' });
    const res = await adminAgent.get(
      `/api/admin/users/${target.id}/llm-proxy-token`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false });
  });

  it('returns the active shape without plaintext or hash', async () => {
    const target = await makeEligibleUser({ role: 'student' });
    await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 500_000 })
      .expect(201);
    const res = await adminAgent.get(
      `/api/admin/users/${target.id}/llm-proxy-token`,
    );
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.tokenLimit).toBe(500_000);
    expect(res.body.tokensUsed).toBe(0);
    expect(res.body.requestCount).toBe(0);
    expect(res.body).not.toHaveProperty('token');
    expect(res.body).not.toHaveProperty('tokenHash');
    expect(res.body).not.toHaveProperty('token_hash');
  });

  it('404 when the user does not exist', async () => {
    const res = await adminAgent.get('/api/admin/users/9999999/llm-proxy-token');
    expect(res.status).toBe(404);
  });
});
