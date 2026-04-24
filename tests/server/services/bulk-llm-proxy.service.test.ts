/**
 * Integration tests for BulkLlmProxyService (group-scoped).
 *
 * Uses a real SQLite database via the shared Prisma client. Exercises
 * the fail-soft loop and the skipped / succeeded / failed result
 * buckets end-to-end.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../server/src/services/prisma.js';
import { BulkLlmProxyService } from '../../../server/src/services/bulk-llm-proxy.service.js';
import { LlmProxyTokenService } from '../../../server/src/services/llm-proxy-token.service.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { NotFoundError } from '../../../server/src/errors.js';
import { makeUser, makeGroup, makeMembership } from '../helpers/factories.js';

const audit = new AuditService();
const tokenService = new LlmProxyTokenService(prisma, audit);
const service = new BulkLlmProxyService(prisma, tokenService);

function futureDate(daysAhead = 30): Date {
  return new Date(Date.now() + daysAhead * 24 * 3600 * 1000);
}

async function resetDb() {
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

beforeEach(resetDb);

// ---------------------------------------------------------------------------
// bulkGrant — group
// ---------------------------------------------------------------------------

describe('BulkLlmProxyService.bulkGrant — group', () => {
  it('grants a token to every active member of the group', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();
    const u1 = await makeUser({ role: 'student' });
    const u2 = await makeUser({ role: 'student' });
    await makeMembership(group, u1);
    await makeMembership(group, u2);

    const result = await service.bulkGrant(
      { kind: 'group', id: group.id },
      { expiresAt: futureDate(), tokenLimit: 777 },
      actor.id,
    );

    expect(result.succeeded.sort()).toEqual([u1.id, u2.id].sort());
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('throws NotFoundError when the group does not exist', async () => {
    const actor = await makeUser({ role: 'admin' });
    await expect(
      service.bulkGrant(
        { kind: 'group', id: 9_999_999 },
        { expiresAt: futureDate(), tokenLimit: 1000 },
        actor.id,
      ),
    ).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// bulkRevoke — group
// ---------------------------------------------------------------------------

describe('BulkLlmProxyService.bulkRevoke — group', () => {
  it('revokes for group members and leaves non-members untouched', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();
    const inGroup = await makeUser({ role: 'student' });
    const outOfGroup = await makeUser({ role: 'student' });
    await makeMembership(group, inGroup);

    // Both have active tokens.
    await tokenService.grant(
      inGroup.id,
      { expiresAt: futureDate(), tokenLimit: 100 },
      actor.id,
    );
    await tokenService.grant(
      outOfGroup.id,
      { expiresAt: futureDate(), tokenLimit: 100 },
      actor.id,
    );

    const result = await service.bulkRevoke(
      { kind: 'group', id: group.id },
      actor.id,
    );

    expect(result.succeeded).toEqual([inGroup.id]);
    // Non-member's token still active.
    const outside = await (prisma as any).llmProxyToken.findFirst({
      where: { user_id: outOfGroup.id },
    });
    expect(outside.revoked_at).toBeNull();
  });
});
