/**
 * Integration tests for the admin LLM-proxy status and request-log endpoints
 * (sprint 003 ticket 005):
 *
 *   GET /api/admin/users/:id/llm-proxy                — full status payload
 *   GET /api/admin/users/:id/llm-proxy/requests?limit — recent LlmProxyRequest rows
 *
 * Real Prisma, real service registry, supertest sessions. The legacy
 * `/llm-proxy-token` spelling must keep returning the same payload.
 *
 * Cleanup is scoped to the users this file creates: the SQLite test DB is
 * shared by every vitest worker, so a global `user.deleteMany` races other
 * files' rows (foreign-key violations under full-suite load).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../../../server/src/app';
import { prisma } from '../../../../server/src/services/prisma';
import { makeUser } from '../../helpers/factories';

let adminAgent: ReturnType<typeof request.agent>;
let studentAgent: ReturnType<typeof request.agent>;
let adminUserId: number;

const KEEP_EMAILS = ['admin-llm-status@example.com', 'student-llm-status@example.com'];

beforeAll(async () => {
  adminAgent = request.agent(app);
  await adminAgent
    .post('/api/auth/test-login')
    .send({ email: KEEP_EMAILS[0], displayName: 'Admin LLM Status', role: 'ADMIN' })
    .expect(200);
  studentAgent = request.agent(app);
  await studentAgent
    .post('/api/auth/test-login')
    .send({ email: KEEP_EMAILS[1], displayName: 'Student LLM Status', role: 'STUDENT' })
    .expect(200);
  adminUserId = (await prisma.user.findFirst({ where: { primary_email: KEEP_EMAILS[0] } }))!.id;
}, 30000);

/** Users created by this file, removed (with their rows) after each test. */
const createdUserIds: number[] = [];

async function newStudent() {
  const user = await makeUser({ role: 'student' });
  createdUserIds.push(user.id);
  return user;
}

async function cleanup() {
  const ids = createdUserIds.splice(0, createdUserIds.length);
  if (ids.length === 0) return;
  await (prisma as any).llmProxyRequest.deleteMany({ where: { user_id: { in: ids } } });
  await (prisma as any).llmProxyToken.deleteMany({ where: { user_id: { in: ids } } });
  await (prisma as any).auditEvent.deleteMany({ where: { target_user_id: { in: ids } } });
  await (prisma as any).login.deleteMany({ where: { user_id: { in: ids } } });
  await (prisma as any).user.deleteMany({ where: { id: { in: ids } } });
}

beforeEach(cleanup);
afterEach(async () => {
  await cleanup();
  delete process.env.LLM_PROXY_ANTHROPIC_ENABLED;
});

function futureIso(daysAhead = 30): string {
  return new Date(Date.now() + daysAhead * 24 * 3600 * 1000).toISOString();
}

async function grantToken(budgetUsd?: number) {
  const target = await newStudent();
  const { row, token } = await registry.llmProxyTokens.grant(
    target.id,
    { expiresAt: new Date(futureIso()), ...(budgetUsd !== undefined ? { budgetUsd } : {}) },
    adminUserId,
  );
  return { target, row, token };
}

async function seedRequest(
  tokenId: number,
  userId: number,
  ts: Date,
  overrides: Record<string, unknown> = {},
) {
  return (prisma as any).llmProxyRequest.create({
    data: {
      token_id: tokenId,
      user_id: userId,
      ts,
      protocol: 'openai',
      model_requested: 'league-small',
      model_sent: 'deepseek/deepseek-v4-flash',
      input_tokens: 10,
      output_tokens: 20,
      cost_usd: 0.001,
      status: 200,
      ...overrides,
    },
  });
}

const STATUS_KEYS = [
  'enabled',
  'token',
  'tokenMasked',
  'budgetUsd',
  'spentUsd',
  'spentUsdTotal',
  'periodResetsAt',
  'tokenLimit',
  'tokensUsed',
  'requestCount',
  'expiresAt',
  'grantedAt',
  'revokedAt',
  'status',
  'endpoint',
  'anthropicEnabled',
  'anthropicEndpoint',
  'models',
];

// ---------------------------------------------------------------------------
// GET /api/admin/users/:id/llm-proxy
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id/llm-proxy', () => {
  it('403 for a student session and 401 unauthenticated', async () => {
    const { target } = await grantToken();
    expect((await studentAgent.get(`/api/admin/users/${target.id}/llm-proxy`)).status).toBe(403);
    expect((await request(app).get(`/api/admin/users/${target.id}/llm-proxy`)).status).toBe(401);
  });

  it('404 for an unknown user and 400 for a malformed id', async () => {
    expect((await adminAgent.get('/api/admin/users/9999999/llm-proxy')).status).toBe(404);
    expect((await adminAgent.get('/api/admin/users/abc/llm-proxy')).status).toBe(400);
  });

  it('returns the full shape for an active token, with the plaintext and the masked key', async () => {
    const { row, target, token } = await grantToken(3);
    await registry.llmProxyTokens.recordUsage(row.id, {
      inputTokens: 10,
      outputTokens: 10,
      costUsd: 0.5,
      modelSent: 'deepseek/deepseek-v4-flash',
    });

    const res = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy`);
    expect(res.status).toBe(200);
    for (const key of STATUS_KEYS) expect(res.body, key).toHaveProperty(key);

    expect(res.body).toMatchObject({
      enabled: true,
      status: 'active',
      tokenId: row.id,
      token,
      tokenMasked: `${token.slice(0, 9)}…${token.slice(-4)}`,
      budgetUsd: 3,
      spentUsd: 0.5,
      spentUsdTotal: 0.5,
      tokenLimit: 1_000_000,
      tokensUsed: 20,
      requestCount: 1,
      revokedAt: null,
      models: ['league-large', 'league-medium', 'league-small'],
    });
    expect(res.body.tokenMasked).not.toBe(token);
    expect(res.body.periodResetsAt).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(res.body.endpoint).toMatch(/^http:\/\/.+\/proxy$/);
    expect(typeof res.body.anthropicEnabled).toBe('boolean');
    expect(res.body).not.toHaveProperty('token_hash');
  });

  it('mirrors the student payload: anthropicEndpoint equals endpoint when enabled, null when off', async () => {
    const { target } = await grantToken();
    process.env.LLM_PROXY_ANTHROPIC_ENABLED = 'true';
    const on = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy`);
    expect(on.body.anthropicEnabled).toBe(true);
    expect(on.body.anthropicEndpoint).toBe(on.body.endpoint);

    process.env.LLM_PROXY_ANTHROPIC_ENABLED = 'false';
    const off = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy`);
    expect(off.body.anthropicEnabled).toBe(false);
    expect(off.body.anthropicEndpoint).toBeNull();
  });

  it('reports disabled with no token, revoked after a revoke, expired after expiry', async () => {
    const never = await newStudent();
    const none = await adminAgent.get(`/api/admin/users/${never.id}/llm-proxy`);
    expect(none.status).toBe(200);
    expect(none.body).toMatchObject({
      enabled: false,
      status: 'disabled',
      token: null,
      tokenMasked: null,
      models: ['league-large', 'league-medium', 'league-small'],
    });
    expect(none.body.endpoint).toMatch(/\/proxy$/);
    expect(none.body).toHaveProperty('anthropicEnabled');

    const { row, target } = await grantToken();
    await registry.llmProxyTokens.revoke(target.id, adminUserId);
    const revoked = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy`);
    expect(revoked.body).toMatchObject({ enabled: false, status: 'revoked', token: null, tokenId: row.id });
    expect(revoked.body.revokedAt).toBeTruthy();

    const other = await grantToken();
    await (prisma as any).llmProxyToken.update({
      where: { id: other.row.id },
      data: { expires_at: new Date(Date.now() - 60_000) },
    });
    const expired = await adminAgent.get(`/api/admin/users/${other.target.id}/llm-proxy`);
    expect(expired.body).toMatchObject({ enabled: false, status: 'expired', token: null });
  });

  it('the legacy /llm-proxy-token spelling returns the same payload', async () => {
    const { target } = await grantToken(2);
    const a = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy`);
    const b = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy-token`);
    expect(b.status).toBe(200);
    // supertest binds an ephemeral port per request, so the host-derived
    // endpoint fields legitimately differ; everything else must match.
    const strip = ({ endpoint, anthropicEndpoint, ...rest }: Record<string, unknown>) => rest;
    expect(strip(b.body)).toEqual(strip(a.body));
    expect(b.body.endpoint).toMatch(/\/proxy$/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/users/:id/llm-proxy/requests
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id/llm-proxy/requests', () => {
  it('403 for a student session and 401 unauthenticated', async () => {
    const { target } = await grantToken();
    expect((await studentAgent.get(`/api/admin/users/${target.id}/llm-proxy/requests`)).status).toBe(403);
    expect((await request(app).get(`/api/admin/users/${target.id}/llm-proxy/requests`)).status).toBe(401);
  });

  it('404 for an unknown user, 400 for a malformed id or limit', async () => {
    const { target } = await grantToken();
    expect((await adminAgent.get('/api/admin/users/9999999/llm-proxy/requests')).status).toBe(404);
    expect((await adminAgent.get('/api/admin/users/abc/llm-proxy/requests')).status).toBe(400);
    for (const limit of ['0', '-1', 'ten', '2.5']) {
      const res = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy/requests?limit=${limit}`);
      expect(res.status, limit).toBe(400);
      expect(res.body.error).toMatch(/limit/);
    }
  });

  it('returns an empty array when the user has made no requests', async () => {
    const { target } = await grantToken();
    const res = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy/requests`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns camelCase rows newest first, only for that user', async () => {
    const { row, target } = await grantToken();
    const other = await grantToken();
    const base = Date.parse('2026-10-10T12:00:00.000Z');
    await seedRequest(row.id, target.id, new Date(base), { model_sent: 'first', cost_usd: 0.01 });
    await seedRequest(row.id, target.id, new Date(base + 2000), {
      model_sent: 'third',
      protocol: 'anthropic',
      model_requested: 'claude-sonnet-4-5',
      input_tokens: 100,
      output_tokens: 200,
      cost_usd: 0.03,
      status: 200,
    });
    await seedRequest(row.id, target.id, new Date(base + 1000), { model_sent: 'second', status: 429 });
    await seedRequest(other.row.id, other.target.id, new Date(base + 5000), { model_sent: 'someone-else' });

    const res = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy/requests`);
    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.modelSent)).toEqual(['third', 'second', 'first']);

    const newest = res.body[0];
    expect(newest).toEqual({
      id: expect.any(Number),
      ts: new Date(base + 2000).toISOString(),
      protocol: 'anthropic',
      modelRequested: 'claude-sonnet-4-5',
      modelSent: 'third',
      inputTokens: 100,
      outputTokens: 200,
      costUsd: 0.03,
      status: 200,
    });
    expect(res.body[1].status).toBe(429);
    for (const r of res.body) {
      expect(r).not.toHaveProperty('token_id');
      expect(r).not.toHaveProperty('user_id');
    }
  });

  it('honours ?limit, defaults to 50 and clamps large values', async () => {
    const { row, target } = await grantToken();
    const base = Date.parse('2026-10-01T00:00:00.000Z');
    for (let i = 0; i < 60; i++) {
      await seedRequest(row.id, target.id, new Date(base + i * 1000), { model_sent: `m${i}` });
    }

    const two = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy/requests?limit=2`);
    expect(two.body.map((r: any) => r.modelSent)).toEqual(['m59', 'm58']);

    const dflt = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy/requests`);
    expect(dflt.body).toHaveLength(50);
    expect(dflt.body[0].modelSent).toBe('m59');

    const big = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy/requests?limit=100000`);
    expect(big.status).toBe(200);
    expect(big.body).toHaveLength(60);
  });

  it('rows outlive revocation: the log is still readable after the token is revoked', async () => {
    const { row, target } = await grantToken();
    await seedRequest(row.id, target.id, new Date());
    await registry.llmProxyTokens.revoke(target.id, adminUserId);
    const res = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy/requests`);
    expect(res.body).toHaveLength(1);
  });
});
