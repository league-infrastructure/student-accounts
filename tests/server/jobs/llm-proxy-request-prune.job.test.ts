/**
 * Tests for the llm-proxy-request-prune job (sprint 003 ticket 001).
 *
 * Covers:
 *  - rows older than RETENTION_DAYS are deleted, newer ones kept, and the
 *    token's running totals are untouched
 *  - the boundary: a row exactly at the cutoff is kept
 *  - the handler never rejects, even when the DB call fails
 *  - JOB_NAME / JOB_FREQUENCY match the scheduler's seedDefaults
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { SchedulerService } from '../../../server/src/services/scheduler.service.js';
import { LlmProxyTokenService } from '../../../server/src/services/llm-proxy-token.service.js';
import {
  createLlmProxyRequestPruneJobHandler,
  retentionCutoff,
  JOB_NAME,
  JOB_FREQUENCY,
  RETENTION_DAYS,
} from '../../../server/src/jobs/llm-proxy-request-prune.job.js';
import { makeUser } from '../helpers/factories.js';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const DAY_MS = 24 * 3600 * 1000;

const service = new LlmProxyTokenService(prisma, new AuditService());

async function clearDb(): Promise<void> {
  await (prisma as any).llmProxyRequest.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

async function seedRequest(tokenId: number, userId: number, ts: Date, costUsd = 0.01) {
  return (prisma as any).llmProxyRequest.create({
    data: {
      token_id: tokenId,
      user_id: userId,
      ts,
      protocol: 'openai',
      model_requested: 'league-small',
      model_sent: 'deepseek/deepseek-v3.2',
      input_tokens: 10,
      output_tokens: 10,
      cost_usd: costUsd,
      status: 200,
    },
  });
}

beforeEach(clearDb);

describe('llm-proxy-request-prune job — constants', () => {
  it('is seeded daily by SchedulerService.seedDefaults under the same name', async () => {
    expect(JOB_NAME).toBe('llm-proxy-request-prune');
    expect(JOB_FREQUENCY).toBe('daily');
    expect(RETENTION_DAYS).toBe(90);

    const scheduler = new SchedulerService(prisma);
    await scheduler.seedDefaults();
    const row = await (prisma as any).scheduledJob.findUnique({ where: { name: JOB_NAME } });
    expect(row).not.toBeNull();
    expect(row.frequency).toBe(JOB_FREQUENCY);
    expect(row.enabled).toBe(true);
  });

  it('retentionCutoff is 90 days before now', () => {
    expect(retentionCutoff(NOW)).toEqual(new Date('2026-07-20T12:00:00.000Z'));
  });
});

describe('llm-proxy-request-prune job — pruning', () => {
  it('deletes rows older than 90 days and keeps the rest and the token totals', async () => {
    const student = await makeUser({ role: 'student' });
    const { row } = await service.grant(student.id, { expiresAt: new Date(NOW.getTime() + 365 * DAY_MS) }, null);
    await (prisma as any).llmProxyToken.update({
      where: { id: row.id },
      data: { spent_usd: 1.5, spent_usd_total: 7.25, request_count: 4, tokens_used: 400 },
    });

    const old1 = await seedRequest(row.id, student.id, new Date(NOW.getTime() - 91 * DAY_MS));
    const old2 = await seedRequest(row.id, student.id, new Date(NOW.getTime() - 400 * DAY_MS));
    const recent = await seedRequest(row.id, student.id, new Date(NOW.getTime() - 10 * DAY_MS));
    const today = await seedRequest(row.id, student.id, NOW);

    const handler = createLlmProxyRequestPruneJobHandler({ prisma, now: () => NOW });
    await handler();

    const remaining = await (prisma as any).llmProxyRequest.findMany({ orderBy: { id: 'asc' } });
    expect(remaining.map((r: any) => r.id)).toEqual([recent.id, today.id]);
    expect(remaining.map((r: any) => r.id)).not.toContain(old1.id);
    expect(remaining.map((r: any) => r.id)).not.toContain(old2.id);

    const token = await (prisma as any).llmProxyToken.findUnique({ where: { id: row.id } });
    expect(token.spent_usd).toBe(1.5);
    expect(token.spent_usd_total).toBe(7.25);
    expect(token.request_count).toBe(4);
    expect(token.tokens_used).toBe(400);
  });

  it('keeps a row exactly at the cutoff and deletes one a millisecond older', async () => {
    const student = await makeUser({ role: 'student' });
    const { row } = await service.grant(student.id, { expiresAt: new Date(NOW.getTime() + 365 * DAY_MS) }, null);
    const cutoff = retentionCutoff(NOW);
    const atCutoff = await seedRequest(row.id, student.id, cutoff);
    await seedRequest(row.id, student.id, new Date(cutoff.getTime() - 1));

    await createLlmProxyRequestPruneJobHandler({ prisma, now: () => NOW })();

    const remaining = await (prisma as any).llmProxyRequest.findMany();
    expect(remaining.map((r: any) => r.id)).toEqual([atCutoff.id]);
  });

  it('is a no-op with nothing to prune and never rejects on a DB failure', async () => {
    await expect(createLlmProxyRequestPruneJobHandler({ prisma, now: () => NOW })()).resolves.toBeUndefined();

    const broken = {
      llmProxyRequest: {
        deleteMany: async () => {
          throw new Error('disk on fire');
        },
      },
    };
    await expect(createLlmProxyRequestPruneJobHandler({ prisma: broken })()).resolves.toBeUndefined();
  });
});
