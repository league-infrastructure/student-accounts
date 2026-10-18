/**
 * Integration tests for the monthly dollar budget on LlmProxyTokenService
 * (sprint 003 ticket 001, SUC-001).
 *
 * Real SQLite via the shared Prisma client; the service clock, pricing and
 * config are injected so the month boundary and prices are deterministic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../server/src/services/prisma.js';
import {
  LlmProxyTokenService,
  LlmProxyTokenQuotaExceededError,
  LlmProxyTokenUnauthorizedError,
  LLM_PROXY_DEFAULT_TOKEN_LIMIT,
  utcMonthStart,
  utcNextMonthStart,
  defaultBudgetUsd,
  isValidBudgetUsd,
} from '../../../server/src/services/llm-proxy-token.service.js';
import { TierPricing } from '../../../server/src/services/llm-proxy-pricing.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { NotFoundError, ValidationError } from '../../../server/src/errors.js';
import { makeUser } from '../helpers/factories.js';

// Fixed "today" in the middle of a month, and a fake config with easy prices.
const OCT_18 = new Date('2026-10-18T12:00:00.000Z');
const OCT_1 = new Date('2026-10-01T00:00:00.000Z');
const NOV_1 = new Date('2026-11-01T00:00:00.000Z');
const SEP_1 = new Date('2026-09-01T00:00:00.000Z');

const configValues: Record<string, string | undefined> = {
  LLM_PROXY_PRICE_LARGE: '10,20',
  LLM_PROXY_PRICE_MEDIUM: '1,2',
  LLM_PROXY_PRICE_SMALL: '0.5,1',
};
const config = (key: string) => configValues[key];

let now = OCT_18;
const audit = new AuditService();
const service = new LlmProxyTokenService(prisma, audit, {
  now: () => now,
  pricing: new TierPricing(config),
  config,
});

function futureDate(daysAhead = 365): Date {
  return new Date(OCT_18.getTime() + daysAhead * 24 * 3600 * 1000);
}

async function resetDb() {
  await (prisma as any).llmProxyRequest.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

async function grantFor(params: { budgetUsd?: number; tokenLimit?: number } = {}) {
  const actor = await makeUser({ role: 'admin' });
  const target = await makeUser({ role: 'student' });
  const result = await service.grant(target.id, { expiresAt: futureDate(), ...params }, actor.id);
  return { actor, target, ...result };
}

async function reload(id: number) {
  return (prisma as any).llmProxyToken.findUnique({ where: { id } });
}

async function setRow(id: number, data: Record<string, unknown>) {
  return (prisma as any).llmProxyToken.update({ where: { id }, data });
}

beforeEach(async () => {
  now = OCT_18;
  delete configValues.LLM_PROXY_DEFAULT_BUDGET_USD;
  await resetDb();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('month helpers and budget validation', () => {
  it('utcMonthStart / utcNextMonthStart work in UTC and across the year end', () => {
    expect(utcMonthStart(OCT_18)).toEqual(OCT_1);
    expect(utcNextMonthStart(OCT_18)).toEqual(NOV_1);
    expect(utcNextMonthStart(new Date('2026-12-31T23:59:59.999Z'))).toEqual(
      new Date('2027-01-01T00:00:00.000Z'),
    );
    // 00:30 UTC on the 1st is already the new month even if it is still the
    // previous day in US time zones.
    expect(utcMonthStart(new Date('2026-11-01T00:30:00.000Z'))).toEqual(NOV_1);
  });

  it('defaultBudgetUsd reads the config and falls back to 5', () => {
    expect(defaultBudgetUsd(() => undefined)).toBe(5);
    expect(defaultBudgetUsd(() => '7.5')).toBe(7.5);
    expect(defaultBudgetUsd(() => 'lots')).toBe(5);
    expect(defaultBudgetUsd(() => '0')).toBe(5);
    expect(defaultBudgetUsd(() => '-3')).toBe(5);
  });

  it('isValidBudgetUsd accepts (0, 1000] numbers only', () => {
    expect(isValidBudgetUsd(0.01)).toBe(true);
    expect(isValidBudgetUsd(1000)).toBe(true);
    for (const bad of [0, -1, 1000.01, Number.NaN, Number.POSITIVE_INFINITY, '5', null, undefined]) {
      expect(isValidBudgetUsd(bad), String(bad)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// grant
// ---------------------------------------------------------------------------

describe('grant with budgets', () => {
  it('applies the default $5 budget, the default token limit and the current period start', async () => {
    const { row } = await grantFor();
    expect(row.budget_usd).toBe(5);
    expect(row.spent_usd).toBe(0);
    expect(row.spent_usd_total).toBe(0);
    expect(row.period_start).toEqual(OCT_1);
    expect(row.token_limit).toBe(LLM_PROXY_DEFAULT_TOKEN_LIMIT);

    const event = await (prisma as any).auditEvent.findFirst({ where: { action: 'grant_llm_proxy_token' } });
    expect(event.details.budgetUsd).toBe(5);
    expect(event.details.tokenLimit).toBe(LLM_PROXY_DEFAULT_TOKEN_LIMIT);
  });

  it('takes an explicit budgetUsd and tokenLimit', async () => {
    const { row } = await grantFor({ budgetUsd: 0.25, tokenLimit: 4242 });
    expect(row.budget_usd).toBe(0.25);
    expect(row.token_limit).toBe(4242);
  });

  it('reads the default budget from LLM_PROXY_DEFAULT_BUDGET_USD', async () => {
    configValues.LLM_PROXY_DEFAULT_BUDGET_USD = '12';
    const { row } = await grantFor();
    expect(row.budget_usd).toBe(12);
    expect(service.defaultBudgetUsd()).toBe(12);
  });

  it('ensureActive mints with the default budget', async () => {
    const student = await makeUser({ role: 'student' });
    const { row, granted } = await service.ensureActive(student.id, null, 'fleet');
    expect(granted).toBe(true);
    expect(row.budget_usd).toBe(5);
    expect(row.period_start).toEqual(OCT_1);
  });
});

// ---------------------------------------------------------------------------
// assertUsable / validate — enforcement and the lazy monthly reset
// ---------------------------------------------------------------------------

describe('assertUsable — dollar budget', () => {
  it('passes while spent_usd < budget_usd and returns the row', async () => {
    const { row, token } = await grantFor({ budgetUsd: 1 });
    await setRow(row.id, { spent_usd: 0.999 });
    const validated = await service.validate(token);
    expect(validated.id).toBe(row.id);
    expect(validated.spent_usd).toBeCloseTo(0.999, 9);
  });

  it('throws LlmProxyTokenQuotaExceededError with the budget and reset date at the cap', async () => {
    const { row, token } = await grantFor({ budgetUsd: 0.01 });
    await setRow(row.id, { spent_usd: 0.01 });
    const err = await service.validate(token).catch((e) => e);
    expect(err).toBeInstanceOf(LlmProxyTokenQuotaExceededError);
    expect(err.statusCode).toBe(429);
    expect(err.message).toBe('monthly budget of $0.01 reached; resets 2026-11-01');
  });

  it('also refuses when spent_usd overshoots the budget', async () => {
    const { row, token } = await grantFor({ budgetUsd: 5 });
    await setRow(row.id, { spent_usd: 5.37 });
    await expect(service.validate(token)).rejects.toThrow(/monthly budget of \$5\.00 reached/);
  });

  it('revoked and expired still win over the budget check', async () => {
    const { row, token, target, actor } = await grantFor({ budgetUsd: 5 });
    await setRow(row.id, { expires_at: new Date(OCT_18.getTime() - 1000) });
    await expect(service.validate(token)).rejects.toThrow(LlmProxyTokenUnauthorizedError);
    await setRow(row.id, { expires_at: futureDate() });
    await service.revoke(target.id, actor.id);
    await expect(service.validate(token)).rejects.toThrow(LlmProxyTokenUnauthorizedError);
  });

  it('an injected `now` overrides the service clock', async () => {
    const { row, token } = await grantFor({ budgetUsd: 5 });
    await setRow(row.id, { spent_usd: 5 });
    // Same month → still over budget.
    await expect(service.validate(token, OCT_18)).rejects.toThrow(LlmProxyTokenQuotaExceededError);
    // First instant of November → the period rolls and the request is allowed.
    const rolled = await service.validate(token, NOV_1);
    expect(rolled.spent_usd).toBe(0);
    expect(rolled.period_start).toEqual(NOV_1);
  });
});

describe('rollPeriodIfNeeded — reset at a new month', () => {
  it('zeroes spent_usd and stamps period_start when period_start is in a previous month', async () => {
    const { row, token } = await grantFor({ budgetUsd: 5 });
    await setRow(row.id, { spent_usd: 5, spent_usd_total: 9, period_start: SEP_1 });

    const validated = await service.validate(token);
    expect(validated.spent_usd).toBe(0);
    expect(validated.period_start).toEqual(OCT_1);
    // Lifetime spend is untouched by the roll.
    expect(validated.spent_usd_total).toBe(9);

    const persisted = await reload(row.id);
    expect(persisted.spent_usd).toBe(0);
    expect(persisted.period_start).toEqual(OCT_1);
  });

  it('treats a null period_start as stale and starts the current period', async () => {
    const { row } = await grantFor({ budgetUsd: 5 });
    await setRow(row.id, { period_start: null, spent_usd: 3 });
    const rolled = await service.rollPeriodIfNeeded(await reload(row.id));
    expect(rolled.period_start).toEqual(OCT_1);
    expect(rolled.spent_usd).toBe(0);
  });

  it('leaves the row alone inside the current month', async () => {
    const { row } = await grantFor({ budgetUsd: 5 });
    await setRow(row.id, { spent_usd: 1.5 });
    const same = await service.rollPeriodIfNeeded(await reload(row.id));
    expect(same.spent_usd).toBe(1.5);
    expect(same.period_start).toEqual(OCT_1);
  });

  it('rolls exactly at the month boundary, not one millisecond before', async () => {
    const { row } = await grantFor({ budgetUsd: 5 });
    await setRow(row.id, { spent_usd: 2 });
    const before = await service.rollPeriodIfNeeded(
      await reload(row.id),
      new Date('2026-10-31T23:59:59.999Z'),
    );
    expect(before.spent_usd).toBe(2);
    const after = await service.rollPeriodIfNeeded(await reload(row.id), NOV_1);
    expect(after.spent_usd).toBe(0);
    expect(after.period_start).toEqual(NOV_1);
  });
});

describe('assertUsable — legacy token-count path (budget_usd null)', () => {
  it('refuses when tokens_used >= token_limit', async () => {
    const { row, token } = await grantFor({ tokenLimit: 100 });
    await setRow(row.id, { budget_usd: null, tokens_used: 100 });
    const err = await service.validate(token).catch((e) => e);
    expect(err).toBeInstanceOf(LlmProxyTokenQuotaExceededError);
    expect(err.message).toBe('LLM proxy token quota exhausted');
  });

  it('ignores spent_usd entirely while budget_usd is null', async () => {
    const { row, token } = await grantFor({ tokenLimit: 100 });
    await setRow(row.id, { budget_usd: null, tokens_used: 99, spent_usd: 999 });
    await expect(service.validate(token)).resolves.toBeTruthy();
  });

  it('tokens over the legacy limit are fine once a budget is set', async () => {
    const { row, token } = await grantFor({ tokenLimit: 100, budgetUsd: 5 });
    await setRow(row.id, { tokens_used: 5000 });
    await expect(service.validate(token)).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// recordUsage — dollars and the request log
// ---------------------------------------------------------------------------

describe('recordUsage', () => {
  it('records the reported cost, bumps every counter and inserts a request row', async () => {
    const { row, target } = await grantFor({ budgetUsd: 5 });

    await service.recordUsage(row.id, {
      inputTokens: 1200,
      outputTokens: 340,
      costUsd: 0.0123,
      modelRequested: 'league-large',
      modelSent: 'deepseek/deepseek-v4-pro',
      protocol: 'openai',
      status: 200,
    });
    await service.recordUsage(row.id, {
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0.0007,
      modelRequested: 'claude-sonnet-4',
      modelSent: 'deepseek/deepseek-v4-flash',
      protocol: 'anthropic',
      status: 200,
    });

    const after = await reload(row.id);
    expect(after.tokens_used).toBe(1200 + 340 + 10 + 20);
    expect(after.request_count).toBe(2);
    expect(after.spent_usd).toBeCloseTo(0.013, 9);
    expect(after.spent_usd_total).toBeCloseTo(0.013, 9);

    const requests = await (prisma as any).llmProxyRequest.findMany({
      where: { token_id: row.id },
      orderBy: { id: 'asc' },
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      token_id: row.id,
      user_id: target.id,
      protocol: 'openai',
      model_requested: 'league-large',
      model_sent: 'deepseek/deepseek-v4-pro',
      input_tokens: 1200,
      output_tokens: 340,
      cost_usd: 0.0123,
      status: 200,
    });
    expect(requests[0].ts).toBeInstanceOf(Date);
    expect(requests[1].protocol).toBe('anthropic');
    expect(requests[1].cost_usd).toBe(0.0007);
  });

  it('falls back to TierPricing for the tier of modelSent when costUsd is absent', async () => {
    const { row } = await grantFor({ budgetUsd: 5 });
    // Config prices: LARGE "10,20" → 1000 in = 0.01, 500 out = 0.01.
    await service.recordUsage(row.id, {
      inputTokens: 1000,
      outputTokens: 500,
      modelSent: 'deepseek/deepseek-v4-pro',
    });
    // null costUsd behaves like absent; unknown slug prices as MEDIUM "1,2".
    await service.recordUsage(row.id, {
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: null,
      modelSent: 'vendor/unknown-model',
    });

    const after = await reload(row.id);
    expect(after.spent_usd).toBeCloseTo(0.02 + 0.002, 12);
    expect(after.spent_usd_total).toBeCloseTo(0.022, 12);

    const requests = await (prisma as any).llmProxyRequest.findMany({
      where: { token_id: row.id },
      orderBy: { id: 'asc' },
    });
    expect(requests[0].cost_usd).toBeCloseTo(0.02, 12);
    expect(requests[1].cost_usd).toBeCloseTo(0.002, 12);
    expect(requests[0].status).toBe(200);
    expect(requests[0].model_requested).toBeNull();
  });

  it('never records a zero cost for a non-empty request when OpenRouter reports nothing', async () => {
    const { row } = await grantFor();
    await service.recordUsage(row.id, { inputTokens: 1, outputTokens: 1 });
    const [req] = await (prisma as any).llmProxyRequest.findMany({ where: { token_id: row.id } });
    expect(req.cost_usd).toBeGreaterThan(0);
  });

  it('prices a report with only token counts as MEDIUM and records no model', async () => {
    const { row } = await grantFor();
    await service.recordUsage(row.id, { inputTokens: 1000, outputTokens: 500 });
    const after = await reload(row.id);
    expect(after.tokens_used).toBe(1500);
    expect(after.request_count).toBe(1);
    expect(after.spent_usd).toBeCloseTo(0.002, 12);
    const [req] = await (prisma as any).llmProxyRequest.findMany({ where: { token_id: row.id } });
    expect(req.protocol).toBe('openai');
    expect(req.model_sent).toBeNull();
    expect(req.input_tokens).toBe(1000);
    expect(req.output_tokens).toBe(500);
  });

  it('clamps negative token counts to zero and swallows unknown ids', async () => {
    const { row } = await grantFor();
    await service.recordUsage(row.id, { inputTokens: -5, outputTokens: -10, costUsd: 0.001 });
    const after = await reload(row.id);
    expect(after.tokens_used).toBe(0);
    expect(after.spent_usd).toBe(0.001);
    await expect(service.recordUsage(9_999_999, { inputTokens: 1, outputTokens: 1 })).resolves.toBeUndefined();
    expect(await (prisma as any).llmProxyRequest.count({ where: { token_id: 9_999_999 } })).toBe(0);
  });

  it('spend recorded this month trips the budget on the next request', async () => {
    const { row, token } = await grantFor({ budgetUsd: 0.01 });
    await service.recordUsage(row.id, { inputTokens: 100, outputTokens: 100, costUsd: 0.006 });
    await expect(service.validate(token)).resolves.toBeTruthy();
    await service.recordUsage(row.id, { inputTokens: 100, outputTokens: 100, costUsd: 0.006 });
    await expect(service.validate(token)).rejects.toThrow(LlmProxyTokenQuotaExceededError);
  });
});

// ---------------------------------------------------------------------------
// periodResetsAt / budgetSummary
// ---------------------------------------------------------------------------

describe('periodResetsAt and budgetSummary', () => {
  it('reset is the first instant of the next UTC month', async () => {
    const { row } = await grantFor();
    expect(service.periodResetsAt(row)).toBe('2026-11-01T00:00:00.000Z');
    expect(service.periodResetsAt(row, new Date('2026-12-15T00:00:00.000Z'))).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('summary reports this period, lifetime and reset; a stale period reads as $0 spent', async () => {
    const { row } = await grantFor({ budgetUsd: 5 });
    await setRow(row.id, { spent_usd: 1.25, spent_usd_total: 4 });
    expect(service.budgetSummary(await reload(row.id))).toEqual({
      budgetUsd: 5,
      spentUsd: 1.25,
      spentUsdTotal: 4,
      periodResetsAt: '2026-11-01T00:00:00.000Z',
    });
    // Last month's period: not yet rolled in the DB, but reported as reset.
    await setRow(row.id, { period_start: SEP_1 });
    const stale = service.budgetSummary(await reload(row.id));
    expect(stale.spentUsd).toBe(0);
    expect(stale.spentUsdTotal).toBe(4);
    expect((await reload(row.id)).spent_usd).toBe(1.25); // read-only
  });

  it('summary of a legacy token has budgetUsd null', async () => {
    const { row } = await grantFor();
    await setRow(row.id, { budget_usd: null });
    expect(service.budgetSummary(await reload(row.id)).budgetUsd).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setBudget / backfillDefaultBudget
// ---------------------------------------------------------------------------

describe('setBudget', () => {
  it('updates budget_usd and audits llm_proxy_budget_changed { from, to }', async () => {
    const { row, actor, target } = await grantFor({ budgetUsd: 5 });
    const updated = await service.setBudget(row.id, 12.5, actor.id);
    expect(updated.budget_usd).toBe(12.5);
    expect((await reload(row.id)).budget_usd).toBe(12.5);

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'llm_proxy_budget_changed' } });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(actor.id);
    expect(events[0].target_user_id).toBe(target.id);
    expect(events[0].target_entity_type).toBe('LlmProxyToken');
    expect(events[0].target_entity_id).toBe(String(row.id));
    expect(events[0].details).toEqual({ from: 5, to: 12.5 });
  });

  it('records from: null when the token had no budget', async () => {
    const { row, actor } = await grantFor();
    await setRow(row.id, { budget_usd: null });
    await service.setBudget(row.id, 5, actor.id);
    const event = await (prisma as any).auditEvent.findFirst({ where: { action: 'llm_proxy_budget_changed' } });
    expect(event.details).toEqual({ from: null, to: 5 });
  });

  it('rejects invalid budgets and unknown tokens', async () => {
    const { row, actor } = await grantFor();
    await expect(service.setBudget(row.id, 0, actor.id)).rejects.toThrow(ValidationError);
    await expect(service.setBudget(row.id, 1000.5, actor.id)).rejects.toThrow(ValidationError);
    await expect(service.setBudget(9_999_999, 5, actor.id)).rejects.toThrow(NotFoundError);
    expect(await (prisma as any).auditEvent.count({ where: { action: 'llm_proxy_budget_changed' } })).toBe(0);
  });
});

describe('backfillDefaultBudget', () => {
  it('sets the default where budget_usd is null, returns the count and is idempotent', async () => {
    const a = await grantFor();
    const b = await grantFor();
    const c = await grantFor({ budgetUsd: 20 });
    await setRow(a.row.id, { budget_usd: null });
    await setRow(b.row.id, { budget_usd: null });
    configValues.LLM_PROXY_DEFAULT_BUDGET_USD = '8';

    expect(await service.backfillDefaultBudget(a.actor.id)).toBe(2);
    expect((await reload(a.row.id)).budget_usd).toBe(8);
    expect((await reload(b.row.id)).budget_usd).toBe(8);
    expect((await reload(c.row.id)).budget_usd).toBe(20);

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'llm_proxy_budget_backfilled' } });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(a.actor.id);
    expect(events[0].details).toEqual({ budgetUsd: 8, count: 2 });

    expect(await service.backfillDefaultBudget(a.actor.id)).toBe(0);
    expect(await (prisma as any).auditEvent.count({ where: { action: 'llm_proxy_budget_backfilled' } })).toBe(1);
  });
});
