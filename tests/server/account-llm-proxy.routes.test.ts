/**
 * Integration tests for GET /api/account/llm-proxy (Sprint 013 T006).
 *
 * Verifies the enabled + disabled response shapes, role gating, and — most
 * importantly — that the endpoint never leaks the plaintext token or its
 * hash to the student.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';
import { makeUser } from './helpers/factories';

let studentAgent: ReturnType<typeof request.agent>;
let studentId: number;

beforeAll(async () => {
  studentAgent = request.agent(app);
  await studentAgent
    .post('/api/auth/test-login')
    .send({
      email: 'student-llm-proxy@example.com',
      displayName: 'Student LLM Proxy',
      role: 'STUDENT',
    })
    .expect(200);
  const student = await prisma.user.findFirst({
    where: { primary_email: 'student-llm-proxy@example.com' },
  });
  studentId = student!.id;
}, 30000);

async function wipeExceptStudent() {
  await (prisma as any).llmProxyRequest.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany({ where: { user_id: { not: studentId } } });
  // Keep the shared student and any sibling staff/admin we created here;
  // wiping them breaks the session-based `studentAgent`. The factory seq
  // counter is process-scoped, so re-running against a handful of leftover
  // rows is safe.
  await (prisma as any).user.deleteMany({
    where: {
      id: { not: studentId },
      primary_email: {
        notIn: [
          'staff-llm-proxy@example.com',
          'admin2-llm-proxy@example.com',
        ],
      },
    },
  });
  await (prisma as any).cohort.deleteMany();
}

beforeEach(async () => {
  await wipeExceptStudent();
});

afterEach(async () => {
  await wipeExceptStudent();
});

// ---------------------------------------------------------------------------
// Auth + role gating
// ---------------------------------------------------------------------------

describe('GET /api/account/llm-proxy — auth', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).get('/api/account/llm-proxy');
    expect(res.status).toBe(401);
  });

  it('403 for a staff user', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/test-login')
      .send({
        email: 'staff-llm-proxy@example.com',
        displayName: 'Staff',
        role: 'staff',
      })
      .expect(200);
    const res = await agent.get('/api/account/llm-proxy');
    expect(res.status).toBe(403);
  });

  it('403 for an admin user', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/test-login')
      .send({
        email: 'admin2-llm-proxy@example.com',
        displayName: 'Admin2',
        role: 'ADMIN',
      })
      .expect(200);
    const res = await agent.get('/api/account/llm-proxy');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Disabled + enabled shapes
// ---------------------------------------------------------------------------

describe('GET /api/account/llm-proxy — response shape', () => {
  it('returns { enabled: false, endpoint } when there is no active token', async () => {
    const res = await studentAgent.get('/api/account/llm-proxy');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(typeof res.body.endpoint).toBe('string');
    expect(res.body.endpoint).toMatch(/\/proxy$/);
    // Sprint 003 ticket 003: the Anthropic surface is on by default.
    expect(res.body.anthropicEnabled).toBe(true);
    expect(res.body.anthropicEndpoint).toBe(res.body.endpoint);
    // Sprint 003 ticket 004: the tier list rides along even when disabled.
    expect(res.body.models).toEqual(['league-large', 'league-medium', 'league-small']);
    expect(res.body).not.toHaveProperty('token');
    expect(res.body).not.toHaveProperty('tokenHash');
  });

  it('returns the enabled shape including the plaintext token, without the hash', async () => {
    const admin = await makeUser({ role: 'admin' });
    const { token: granted } = await registry.llmProxyTokens.grant(
      studentId,
      {
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        tokenLimit: 777_000,
      },
      admin.id,
    );

    const res = await studentAgent.get('/api/account/llm-proxy');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.tokenLimit).toBe(777_000);
    expect(res.body.tokensUsed).toBe(0);
    expect(res.body.requestCount).toBe(0);
    expect(typeof res.body.endpoint).toBe('string');
    expect(res.body.endpoint).toMatch(/\/proxy$/);
    expect(res.body.anthropicEnabled).toBe(true);
    expect(res.body.anthropicEndpoint).toBe(res.body.endpoint);
    expect(res.body.models).toEqual(['league-large', 'league-medium', 'league-small']);
    // Plaintext token is surfaced so the student can see and use it.
    expect(res.body.token).toBe(granted);
    expect(res.body).not.toHaveProperty('tokenHash');
    expect(res.body).not.toHaveProperty('token_hash');
    // Sprint 003: dollar budget fields with the $5 default.
    expect(res.body.budgetUsd).toBe(5);
    expect(res.body.spentUsd).toBe(0);
    expect(res.body.spentUsdTotal).toBe(0);
    expect(res.body.periodResetsAt).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  });
});

// ---------------------------------------------------------------------------
// Dollar budget fields (sprint 003 ticket 001, SUC-006)
// ---------------------------------------------------------------------------

describe('GET /api/account/llm-proxy and GET /api/account — budget fields', () => {
  it('reports the budget, spend this period, lifetime spend and the reset date', async () => {
    const admin = await makeUser({ role: 'admin' });
    const { row } = await registry.llmProxyTokens.grant(
      studentId,
      { expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000), budgetUsd: 2.5 },
      admin.id,
    );
    await registry.llmProxyTokens.recordUsage(row.id, {
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.75,
      modelSent: 'deepseek/deepseek-v4-flash',
    });

    const res = await studentAgent.get('/api/account/llm-proxy');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true,
      budgetUsd: 2.5,
      spentUsd: 0.75,
      spentUsdTotal: 0.75,
      requestCount: 1,
      tokensUsed: 150,
    });
    const now = new Date();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    expect(res.body.periodResetsAt).toBe(nextMonth.toISOString());

    // GET /api/account profile.llmProxy mirrors the same fields.
    const account = await studentAgent.get('/api/account');
    expect(account.status).toBe(200);
    expect(account.body.profile.llmProxyEnabled).toBe(true);
    expect(account.body.profile.llmProxy).toMatchObject({
      budgetUsd: 2.5,
      spentUsd: 0.75,
      spentUsdTotal: 0.75,
      periodResetsAt: nextMonth.toISOString(),
    });
    expect(typeof account.body.profile.llmProxy.token).toBe('string');
    expect(account.body.profile.llmProxy.endpoint).toMatch(/\/proxy$/);
    expect(account.body.profile.llmProxy.anthropicEnabled).toBe(true);
    expect(account.body.profile.llmProxy.anthropicEndpoint).toBe(
      account.body.profile.llmProxy.endpoint,
    );
    expect(account.body.profile.llmProxy.models).toEqual([
      'league-large',
      'league-medium',
      'league-small',
    ]);
  });

  it('a legacy token (budget_usd null) reports budgetUsd null', async () => {
    const admin = await makeUser({ role: 'admin' });
    const { row } = await registry.llmProxyTokens.grant(
      studentId,
      { expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000), tokenLimit: 1000 },
      admin.id,
    );
    await (prisma as any).llmProxyToken.update({ where: { id: row.id }, data: { budget_usd: null } });
    const res = await studentAgent.get('/api/account/llm-proxy');
    expect(res.status).toBe(200);
    expect(res.body.budgetUsd).toBeNull();
    expect(res.body.tokenLimit).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Anthropic surface flag (sprint 003 ticket 003, SUC-002)
// ---------------------------------------------------------------------------

describe('GET /api/account/llm-proxy — anthropicEnabled / anthropicEndpoint', () => {
  afterEach(() => {
    delete process.env.LLM_PROXY_ANTHROPIC_ENABLED;
  });

  it('reports the proxy base as anthropicEndpoint when enabled, derived from the forwarded host', async () => {
    const res = await studentAgent
      .get('/api/account/llm-proxy')
      .set('X-Forwarded-Proto', 'https')
      .set('X-Forwarded-Host', 'accounts.example.org');
    expect(res.status).toBe(200);
    expect(res.body.endpoint).toBe('https://accounts.example.org/proxy');
    expect(res.body.anthropicEnabled).toBe(true);
    expect(res.body.anthropicEndpoint).toBe('https://accounts.example.org/proxy');
  });

  it('reports anthropicEnabled false and a null anthropicEndpoint when LLM_PROXY_ANTHROPIC_ENABLED is "false"', async () => {
    process.env.LLM_PROXY_ANTHROPIC_ENABLED = 'false';
    const admin = await makeUser({ role: 'admin' });
    await registry.llmProxyTokens.grant(
      studentId,
      { expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
      admin.id,
    );

    const res = await studentAgent.get('/api/account/llm-proxy');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.anthropicEnabled).toBe(false);
    expect(res.body.anthropicEndpoint).toBeNull();
    expect(res.body.endpoint).toMatch(/\/proxy$/);

    // The GET /api/account mirror agrees.
    const account = await studentAgent.get('/api/account');
    expect(account.body.profile.llmProxy.anthropicEnabled).toBe(false);
    expect(account.body.profile.llmProxy.anthropicEndpoint).toBeNull();

    // And the disabled shape carries the fields too.
    await registry.llmProxyTokens.revoke(studentId, admin.id);
    const off = await studentAgent.get('/api/account/llm-proxy');
    expect(off.body).toMatchObject({ enabled: false, anthropicEnabled: false, anthropicEndpoint: null });
  });
});
