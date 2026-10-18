/**
 * Integration tests for the admin budget endpoints (sprint 003 ticket 001):
 *
 *   PATCH /api/admin/llm-proxy/tokens/:id        { budgetUsd }
 *   POST  /api/admin/llm-proxy/backfill-budgets
 *
 * plus `budgetUsd` on the grant endpoints and the dollar fields on the admin
 * status payload. Real Prisma, real service registry, supertest sessions.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../../../server/src/app';
import { prisma } from '../../../../server/src/services/prisma';
import { makeUser } from '../../helpers/factories';

let adminAgent: ReturnType<typeof request.agent>;
let studentAgent: ReturnType<typeof request.agent>;
let adminUserId: number;
let studentUserId: number;

const KEEP_EMAILS = ['admin-llm-budget@example.com', 'student-llm-budget@example.com'];

beforeAll(async () => {
  adminAgent = request.agent(app);
  await adminAgent
    .post('/api/auth/test-login')
    .send({ email: KEEP_EMAILS[0], displayName: 'Admin LLM Budget', role: 'ADMIN' })
    .expect(200);
  studentAgent = request.agent(app);
  await studentAgent
    .post('/api/auth/test-login')
    .send({ email: KEEP_EMAILS[1], displayName: 'Student LLM Budget', role: 'STUDENT' })
    .expect(200);
  adminUserId = (await prisma.user.findFirst({ where: { primary_email: KEEP_EMAILS[0] } }))!.id;
  studentUserId = (await prisma.user.findFirst({ where: { primary_email: KEEP_EMAILS[1] } }))!.id;
}, 30000);

async function wipe() {
  await (prisma as any).llmProxyRequest.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany({ where: { user_id: { notIn: [adminUserId, studentUserId] } } });
  await (prisma as any).user.deleteMany({ where: { id: { notIn: [adminUserId, studentUserId] } } });
}

beforeEach(wipe);
afterEach(async () => {
  await wipe();
  delete process.env.LLM_PROXY_DEFAULT_BUDGET_USD;
});

function futureIso(daysAhead = 30): string {
  return new Date(Date.now() + daysAhead * 24 * 3600 * 1000).toISOString();
}

async function grantToken(budgetUsd?: number) {
  const target = await makeUser({ role: 'student' });
  const { row, token } = await registry.llmProxyTokens.grant(
    target.id,
    { expiresAt: new Date(futureIso()), ...(budgetUsd !== undefined ? { budgetUsd } : {}) },
    adminUserId,
  );
  return { target, row, token };
}

const patchBudget = (agent: ReturnType<typeof request.agent>, id: number | string, body: unknown) =>
  agent.patch(`/api/admin/llm-proxy/tokens/${id}`).send(body as any);

// ---------------------------------------------------------------------------
// PATCH /api/admin/llm-proxy/tokens/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/llm-proxy/tokens/:id', () => {
  it('200 changes the budget, returns the status shape and writes the audit row', async () => {
    const { row, target } = await grantToken(5);
    const res = await patchBudget(adminAgent, row.id, { budgetUsd: 10 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true,
      tokenId: row.id,
      userId: target.id,
      budgetUsd: 10,
      spentUsd: 0,
      spentUsdTotal: 0,
      tokenLimit: 1_000_000,
    });
    expect(res.body.periodResetsAt).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(res.body).not.toHaveProperty('token');
    expect(res.body).not.toHaveProperty('token_hash');

    const reloaded = await (prisma as any).llmProxyToken.findUnique({ where: { id: row.id } });
    expect(reloaded.budget_usd).toBe(10);

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'llm_proxy_budget_changed' } });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(adminUserId);
    expect(events[0].target_user_id).toBe(target.id);
    expect(events[0].target_entity_id).toBe(String(row.id));
    expect(events[0].details).toEqual({ from: 5, to: 10 });
  });

  it('accepts fractional dollars and the $1000 maximum', async () => {
    const { row } = await grantToken();
    expect((await patchBudget(adminAgent, row.id, { budgetUsd: 0.01 })).status).toBe(200);
    expect((await patchBudget(adminAgent, row.id, { budgetUsd: 1000 })).status).toBe(200);
    const reloaded = await (prisma as any).llmProxyToken.findUnique({ where: { id: row.id } });
    expect(reloaded.budget_usd).toBe(1000);
  });

  it('400 for a missing, non-numeric, zero, negative or too-large budget; nothing audited', async () => {
    const { row } = await grantToken();
    for (const body of [{}, { budgetUsd: '5' }, { budgetUsd: 0 }, { budgetUsd: -1 }, { budgetUsd: 1000.01 }, { budgetUsd: null }]) {
      const res = await patchBudget(adminAgent, row.id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toMatch(/budgetUsd/);
    }
    expect((await patchBudget(adminAgent, 'abc', { budgetUsd: 5 })).status).toBe(400);
    expect(await (prisma as any).auditEvent.count({ where: { action: 'llm_proxy_budget_changed' } })).toBe(0);
    const reloaded = await (prisma as any).llmProxyToken.findUnique({ where: { id: row.id } });
    expect(reloaded.budget_usd).toBe(5);
  });

  it('404 for an unknown token id', async () => {
    const res = await patchBudget(adminAgent, 9_999_999, { budgetUsd: 5 });
    expect(res.status).toBe(404);
  });

  it('403 for a student session and 401 unauthenticated', async () => {
    const { row } = await grantToken();
    expect((await patchBudget(studentAgent, row.id, { budgetUsd: 999 })).status).toBe(403);
    expect((await request(app).patch(`/api/admin/llm-proxy/tokens/${row.id}`).send({ budgetUsd: 999 })).status).toBe(401);
    const reloaded = await (prisma as any).llmProxyToken.findUnique({ where: { id: row.id } });
    expect(reloaded.budget_usd).toBe(5);
  });

  it('the new limit is what the student then sees', async () => {
    const { row, token } = await grantToken(5);
    await (prisma as any).llmProxyToken.update({ where: { id: row.id }, data: { spent_usd: 5 } });
    await expect(registry.llmProxyTokens.validate(token)).rejects.toThrow(/monthly budget/);
    await patchBudget(adminAgent, row.id, { budgetUsd: 6 }).expect(200);
    await expect(registry.llmProxyTokens.validate(token)).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/llm-proxy/backfill-budgets
// ---------------------------------------------------------------------------

describe('POST /api/admin/llm-proxy/backfill-budgets', () => {
  it('sets the default budget where null and reports the count', async () => {
    const a = await grantToken();
    const b = await grantToken();
    const c = await grantToken(20);
    await (prisma as any).llmProxyToken.updateMany({
      where: { id: { in: [a.row.id, b.row.id] } },
      data: { budget_usd: null },
    });

    const res = await adminAgent.post('/api/admin/llm-proxy/backfill-budgets').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2, budgetUsd: 5 });

    const rows = await (prisma as any).llmProxyToken.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r: any) => r.budget_usd)).toEqual([5, 5, 20]);
    expect(c.row.budget_usd).toBe(20);

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'llm_proxy_budget_backfilled' } });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(adminUserId);
    expect(events[0].details).toEqual({ budgetUsd: 5, count: 2 });

    const again = await adminAgent.post('/api/admin/llm-proxy/backfill-budgets').send({});
    expect(again.body).toEqual({ updated: 0, budgetUsd: 5 });
  });

  it('uses LLM_PROXY_DEFAULT_BUDGET_USD when set', async () => {
    const a = await grantToken();
    await (prisma as any).llmProxyToken.update({ where: { id: a.row.id }, data: { budget_usd: null } });
    process.env.LLM_PROXY_DEFAULT_BUDGET_USD = '7';
    const res = await adminAgent.post('/api/admin/llm-proxy/backfill-budgets').send({});
    expect(res.body).toEqual({ updated: 1, budgetUsd: 7 });
  });

  it('403 for a student session', async () => {
    const res = await studentAgent.post('/api/admin/llm-proxy/backfill-budgets').send({});
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Grant endpoints and status payload carry budgetUsd
// ---------------------------------------------------------------------------

describe('grant and status payloads with budgets', () => {
  it('POST /api/admin/users/:id/llm-proxy-token accepts budgetUsd and makes tokenLimit optional', async () => {
    const target = await makeUser({ role: 'student' });
    const res = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), budgetUsd: 2.5 });
    expect(res.status).toBe(201);
    expect(res.body.budgetUsd).toBe(2.5);
    expect(res.body.tokenLimit).toBe(1_000_000);
    const row = await (prisma as any).llmProxyToken.findUnique({ where: { id: res.body.tokenId } });
    expect(row.budget_usd).toBe(2.5);
    expect(row.period_start).not.toBeNull();
  });

  it('POST grant defaults budgetUsd to $5 when omitted and rejects a bad budgetUsd with 400', async () => {
    const target = await makeUser({ role: 'student' });
    const ok = await adminAgent
      .post(`/api/admin/users/${target.id}/llm-proxy-token`)
      .send({ expiresAt: futureIso(), tokenLimit: 1000 });
    expect(ok.status).toBe(201);
    expect(ok.body.budgetUsd).toBe(5);

    const other = await makeUser({ role: 'student' });
    for (const budgetUsd of [0, -2, 5000, 'five']) {
      const res = await adminAgent
        .post(`/api/admin/users/${other.id}/llm-proxy-token`)
        .send({ expiresAt: futureIso(), budgetUsd });
      expect(res.status, String(budgetUsd)).toBe(400);
    }
    expect(await registry.llmProxyTokens.getActiveForUser(other.id)).toBeNull();
  });

  it('GET /api/admin/users/:id/llm-proxy-token includes the dollar fields', async () => {
    const { row, target } = await grantToken(3);
    await registry.llmProxyTokens.recordUsage(row.id, {
      inputTokens: 10,
      outputTokens: 10,
      costUsd: 0.5,
      modelSent: 'deepseek/deepseek-v4-flash',
    });
    const res = await adminAgent.get(`/api/admin/users/${target.id}/llm-proxy-token`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true,
      budgetUsd: 3,
      spentUsd: 0.5,
      spentUsdTotal: 0.5,
      requestCount: 1,
    });
    expect(res.body.periodResetsAt).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  });

  it('bulk grant by group passes budgetUsd through', async () => {
    const group = await (prisma as any).group.create({ data: { name: 'Budget Group' } });
    const m1 = await makeUser({ role: 'student' });
    const m2 = await makeUser({ role: 'student' });
    await (prisma as any).userGroup.createMany({
      data: [
        { user_id: m1.id, group_id: group.id },
        { user_id: m2.id, group_id: group.id },
      ],
    });
    const res = await adminAgent
      .post(`/api/admin/groups/${group.id}/llm-proxy/bulk-grant`)
      .send({ expiresAt: futureIso(), budgetUsd: 1.5 });
    expect(res.status).toBe(200);
    expect(res.body.succeeded.sort()).toEqual([m1.id, m2.id].sort());
    for (const id of [m1.id, m2.id]) {
      const active = await registry.llmProxyTokens.getActiveForUser(id);
      expect(active?.budget_usd).toBe(1.5);
      expect(active?.token_limit).toBe(1_000_000);
    }

    const bad = await adminAgent
      .post(`/api/admin/groups/${group.id}/llm-proxy/bulk-grant`)
      .send({ expiresAt: futureIso(), budgetUsd: 0 });
    expect(bad.status).toBe(400);
  });
});
