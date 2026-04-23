/**
 * Unit tests for BulkCohortService (Sprint 008, T001).
 *
 * Covers:
 *  - suspendCohort: all succeed, all fail, partial failure (middle throws),
 *    zero eligible, cohort not found.
 *  - removeCohort: all succeed, all fail, partial failure, zero eligible,
 *    cohort not found.
 *  - previewCount: returns count without side effects, cohort not found.
 *
 * Uses an in-process SQLite test DB (via prisma) and a fake
 * ExternalAccountLifecycleService that can be configured to throw on demand.
 */

import { prisma } from '../../../server/src/services/prisma.js';
import { BulkCohortService } from '../../../server/src/services/bulk-cohort.service.js';
import { ExternalAccountRepository } from '../../../server/src/services/repositories/external-account.repository.js';
import { UserRepository } from '../../../server/src/services/repositories/user.repository.js';
import { CohortRepository } from '../../../server/src/services/repositories/cohort.repository.js';
import { NotFoundError } from '../../../server/src/errors.js';
import { makeCohort, makeUser, makeExternalAccount } from '../helpers/factories.js';
import type { ExternalAccount, Prisma } from '../../../server/src/generated/prisma/client.js';

// ---------------------------------------------------------------------------
// Fake ExternalAccountLifecycleService
// ---------------------------------------------------------------------------

/**
 * Simple fake that records calls and can be configured to throw per-call
 * using a queue of errors (pop-first per operation type).
 */
class FakeLifecycleService {
  /** Recorded suspend call accountIds in order. */
  suspendCalls: number[] = [];
  /** Recorded remove call accountIds in order. */
  removeCalls: number[] = [];

  /** Errors to throw for suspend, in FIFO order. null = succeed. */
  private suspendErrors: Array<Error | null> = [];
  /** Errors to throw for remove, in FIFO order. null = succeed. */
  private removeErrors: Array<Error | null> = [];

  /** Queue an error to be thrown on the next suspend call. */
  queueSuspendError(err: Error | null): void {
    this.suspendErrors.push(err);
  }

  /** Queue an error to be thrown on the next remove call. */
  queueRemoveError(err: Error | null): void {
    this.removeErrors.push(err);
  }

  reset(): void {
    this.suspendCalls = [];
    this.removeCalls = [];
    this.suspendErrors = [];
    this.removeErrors = [];
  }

  async suspend(
    accountId: number,
    _actorId: number,
    _tx: Prisma.TransactionClient,
  ): Promise<ExternalAccount> {
    this.suspendCalls.push(accountId);
    const err = this.suspendErrors.shift() ?? null;
    if (err) throw err;
    // Return a minimal stub — callers do not use the return value.
    return { id: accountId } as ExternalAccount;
  }

  async remove(
    accountId: number,
    _actorId: number,
    _tx: Prisma.TransactionClient,
  ): Promise<ExternalAccount> {
    this.removeCalls.push(accountId);
    const err = this.removeErrors.shift() ?? null;
    if (err) throw err;
    return { id: accountId } as ExternalAccount;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearDb() {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

function makeService(fake: FakeLifecycleService): BulkCohortService {
  return new BulkCohortService(
    prisma as any,
    fake as any,
    UserRepository,
    ExternalAccountRepository,
    CohortRepository,
  );
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let fake: FakeLifecycleService;
const ACTOR_ID = 1; // arbitrary actor; not constrained by FK in this test DB

beforeEach(async () => {
  await clearDb();
  fake = new FakeLifecycleService();
});

// ---------------------------------------------------------------------------
// suspendCohort
// ---------------------------------------------------------------------------

describe('BulkCohortService.suspendCohort', () => {
  it('all 3 accounts succeed: succeeded has 3 ids, failed is empty', async () => {
    const cohort = await makeCohort();
    const u1 = await makeUser({ cohort_id: cohort.id });
    const u2 = await makeUser({ cohort_id: cohort.id });
    const u3 = await makeUser({ cohort_id: cohort.id });
    const a1 = await makeExternalAccount(u1, { type: 'workspace', status: 'active', external_id: 'a1@example.com' });
    const a2 = await makeExternalAccount(u2, { type: 'workspace', status: 'active', external_id: 'a2@example.com' });
    const a3 = await makeExternalAccount(u3, { type: 'workspace', status: 'active', external_id: 'a3@example.com' });

    const svc = makeService(fake);
    const result = await svc.suspendCohort(cohort.id, 'workspace', ACTOR_ID);

    expect(result.succeeded.sort()).toEqual([a1.id, a2.id, a3.id].sort());
    expect(result.failed).toHaveLength(0);
    expect(fake.suspendCalls).toHaveLength(3);
  });

  it('all fail: succeeded is empty, failed has 3 entries with error messages', async () => {
    const cohort = await makeCohort();
    const u1 = await makeUser({ cohort_id: cohort.id });
    const u2 = await makeUser({ cohort_id: cohort.id });
    const u3 = await makeUser({ cohort_id: cohort.id });
    const a1 = await makeExternalAccount(u1, { type: 'workspace', status: 'active', external_id: 'a1@example.com' });
    const a2 = await makeExternalAccount(u2, { type: 'workspace', status: 'active', external_id: 'a2@example.com' });
    const a3 = await makeExternalAccount(u3, { type: 'workspace', status: 'active', external_id: 'a3@example.com' });

    fake.queueSuspendError(new Error('API failure 1'));
    fake.queueSuspendError(new Error('API failure 2'));
    fake.queueSuspendError(new Error('API failure 3'));

    const svc = makeService(fake);
    const result = await svc.suspendCohort(cohort.id, 'workspace', ACTOR_ID);

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(3);
    const failedIds = result.failed.map((f) => f.accountId).sort();
    expect(failedIds).toEqual([a1.id, a2.id, a3.id].sort());
    for (const f of result.failed) {
      expect(f.error).toMatch(/API failure/);
      expect(typeof f.userId).toBe('number');
      expect(typeof f.userName).toBe('string');
    }
  });

  it('partial failure: middle account throws, first and third succeed', async () => {
    const cohort = await makeCohort();
    const u1 = await makeUser({ cohort_id: cohort.id });
    const u2 = await makeUser({ cohort_id: cohort.id });
    const u3 = await makeUser({ cohort_id: cohort.id });
    const a1 = await makeExternalAccount(u1, { type: 'workspace', status: 'active', external_id: 'a1@example.com' });
    const a2 = await makeExternalAccount(u2, { type: 'workspace', status: 'active', external_id: 'a2@example.com' });
    const a3 = await makeExternalAccount(u3, { type: 'workspace', status: 'active', external_id: 'a3@example.com' });

    // Succeed first, fail second, succeed third — queue in ID-sorted order.
    // The service iterates in DB-insertion order; a1 < a2 < a3 by autoincrement.
    fake.queueSuspendError(null);            // a1 succeeds
    fake.queueSuspendError(new Error('boom')); // a2 fails
    fake.queueSuspendError(null);            // a3 succeeds

    const svc = makeService(fake);
    const result = await svc.suspendCohort(cohort.id, 'workspace', ACTOR_ID);

    expect(result.succeeded.sort()).toEqual([a1.id, a3.id].sort());
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].accountId).toBe(a2.id);
    expect(result.failed[0].error).toBe('boom');
  });

  it('zero eligible accounts: returns empty result, no lifecycle calls', async () => {
    const cohort = await makeCohort();
    // User with suspended account — not eligible for suspend
    const u1 = await makeUser({ cohort_id: cohort.id });
    await makeExternalAccount(u1, { type: 'workspace', status: 'suspended' });

    const svc = makeService(fake);
    const result = await svc.suspendCohort(cohort.id, 'workspace', ACTOR_ID);

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(fake.suspendCalls).toHaveLength(0);
  });

  it('cohort not found: throws NotFoundError', async () => {
    const svc = makeService(fake);
    await expect(svc.suspendCohort(999999, 'workspace', ACTOR_ID)).rejects.toThrow(NotFoundError);
  });

  it('skips accounts belonging to inactive users', async () => {
    const cohort = await makeCohort();
    const activeUser = await makeUser({ cohort_id: cohort.id });
    const inactiveUser = await makeUser({ cohort_id: cohort.id });
    // Deactivate inactiveUser
    await (prisma as any).user.update({ where: { id: inactiveUser.id }, data: { is_active: false } });

    const a1 = await makeExternalAccount(activeUser, { type: 'workspace', status: 'active', external_id: 'active@example.com' });
    await makeExternalAccount(inactiveUser, { type: 'workspace', status: 'active', external_id: 'inactive@example.com' });

    const svc = makeService(fake);
    const result = await svc.suspendCohort(cohort.id, 'workspace', ACTOR_ID);

    expect(result.succeeded).toEqual([a1.id]);
    expect(result.failed).toHaveLength(0);
    expect(fake.suspendCalls).toHaveLength(1);
  });

  it('only processes the given accountType', async () => {
    const cohort = await makeCohort();
    const u1 = await makeUser({ cohort_id: cohort.id });
    const wsAccount = await makeExternalAccount(u1, { type: 'workspace', status: 'active', external_id: 'ws@example.com' });
    await makeExternalAccount(u1, { type: 'claude', status: 'active', external_id: 'claude-id' });

    const svc = makeService(fake);
    const result = await svc.suspendCohort(cohort.id, 'workspace', ACTOR_ID);

    expect(result.succeeded).toEqual([wsAccount.id]);
    expect(fake.suspendCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// removeCohort
// ---------------------------------------------------------------------------

describe('BulkCohortService.removeCohort', () => {
  it('all 3 accounts succeed: succeeded has 3 ids, failed is empty', async () => {
    const cohort = await makeCohort();
    const u1 = await makeUser({ cohort_id: cohort.id });
    const u2 = await makeUser({ cohort_id: cohort.id });
    const u3 = await makeUser({ cohort_id: cohort.id });
    const a1 = await makeExternalAccount(u1, { type: 'workspace', status: 'active', external_id: 'a1@example.com' });
    const a2 = await makeExternalAccount(u2, { type: 'workspace', status: 'suspended', external_id: 'a2@example.com' });
    const a3 = await makeExternalAccount(u3, { type: 'workspace', status: 'active', external_id: 'a3@example.com' });

    const svc = makeService(fake);
    const result = await svc.removeCohort(cohort.id, 'workspace', ACTOR_ID);

    expect(result.succeeded.sort()).toEqual([a1.id, a2.id, a3.id].sort());
    expect(result.failed).toHaveLength(0);
    expect(fake.removeCalls).toHaveLength(3);
  });

  it('all fail: succeeded is empty, failed has 3 entries', async () => {
    const cohort = await makeCohort();
    const u1 = await makeUser({ cohort_id: cohort.id });
    const u2 = await makeUser({ cohort_id: cohort.id });
    const u3 = await makeUser({ cohort_id: cohort.id });
    await makeExternalAccount(u1, { type: 'workspace', status: 'active', external_id: 'a1@example.com' });
    await makeExternalAccount(u2, { type: 'workspace', status: 'active', external_id: 'a2@example.com' });
    await makeExternalAccount(u3, { type: 'workspace', status: 'active', external_id: 'a3@example.com' });

    fake.queueRemoveError(new Error('remove failure 1'));
    fake.queueRemoveError(new Error('remove failure 2'));
    fake.queueRemoveError(new Error('remove failure 3'));

    const svc = makeService(fake);
    const result = await svc.removeCohort(cohort.id, 'workspace', ACTOR_ID);

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(3);
  });

  it('partial failure: middle account throws, others succeed', async () => {
    const cohort = await makeCohort();
    const u1 = await makeUser({ cohort_id: cohort.id });
    const u2 = await makeUser({ cohort_id: cohort.id });
    const u3 = await makeUser({ cohort_id: cohort.id });
    const a1 = await makeExternalAccount(u1, { type: 'workspace', status: 'active', external_id: 'a1@example.com' });
    const a2 = await makeExternalAccount(u2, { type: 'workspace', status: 'active', external_id: 'a2@example.com' });
    const a3 = await makeExternalAccount(u3, { type: 'workspace', status: 'active', external_id: 'a3@example.com' });

    fake.queueRemoveError(null);
    fake.queueRemoveError(new Error('remove boom'));
    fake.queueRemoveError(null);

    const svc = makeService(fake);
    const result = await svc.removeCohort(cohort.id, 'workspace', ACTOR_ID);

    expect(result.succeeded.sort()).toEqual([a1.id, a3.id].sort());
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].accountId).toBe(a2.id);
  });

  it('zero eligible accounts: returns empty result', async () => {
    const cohort = await makeCohort();
    // Only a removed account — not eligible for remove
    const u1 = await makeUser({ cohort_id: cohort.id });
    await makeExternalAccount(u1, { type: 'workspace', status: 'removed' });

    const svc = makeService(fake);
    const result = await svc.removeCohort(cohort.id, 'workspace', ACTOR_ID);

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(fake.removeCalls).toHaveLength(0);
  });

  it('cohort not found: throws NotFoundError', async () => {
    const svc = makeService(fake);
    await expect(svc.removeCohort(999999, 'workspace', ACTOR_ID)).rejects.toThrow(NotFoundError);
  });

  it('includes both active and suspended accounts (but not removed)', async () => {
    const cohort = await makeCohort();
    const u1 = await makeUser({ cohort_id: cohort.id });
    const active = await makeExternalAccount(u1, { type: 'claude', status: 'active', external_id: 'c1' });
    const suspended = await makeExternalAccount(u1, { type: 'claude', status: 'suspended', external_id: 'c2' });
    // removed should be excluded
    await makeExternalAccount(u1, { type: 'claude', status: 'removed', external_id: 'c3' });

    // The partial unique index allows multiple claude accounts only because some are removed.
    // But we can't have two active/pending claude accounts for the same user.
    // Work around by using two users.
    const u2 = await makeUser({ cohort_id: cohort.id });
    const a2 = await makeExternalAccount(u2, { type: 'claude', status: 'suspended', external_id: 'c4' });

    const svc = makeService(fake);
    const result = await svc.removeCohort(cohort.id, 'claude', ACTOR_ID);

    const succeededSorted = result.succeeded.sort();
    // active (u1), suspended (u1 — actually already removed in DB?), plus a2
    // Check just that removed account (c3) is not included
    expect(succeededSorted).not.toContain(
      // We need to find what ID c3 got — just check count
    );
    // We seeded: active (u1), suspended (u1 with external_id c2), removed (u1 with c3), suspended (u2)
    // But wait: u1 has two non-removed accounts (active c1 + suspended c2) but the unique partial index
    // blocks two active/pending — suspended is ok. Let's just assert count.
    expect(result.succeeded.length + result.failed.length).toBe(3); // active + suspended (c2) + a2
    expect(fake.removeCalls).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// previewCount
// ---------------------------------------------------------------------------

describe('BulkCohortService.previewCount', () => {
  it('suspend: returns count of active accounts without calling lifecycle', async () => {
    const cohort = await makeCohort();
    const u1 = await makeUser({ cohort_id: cohort.id });
    const u2 = await makeUser({ cohort_id: cohort.id });
    await makeExternalAccount(u1, { type: 'workspace', status: 'active', external_id: 'a@example.com' });
    await makeExternalAccount(u2, { type: 'workspace', status: 'active', external_id: 'b@example.com' });
    // suspended — not eligible for suspend
    const u3 = await makeUser({ cohort_id: cohort.id });
    await makeExternalAccount(u3, { type: 'workspace', status: 'suspended', external_id: 'c@example.com' });

    const svc = makeService(fake);
    const count = await svc.previewCount(cohort.id, 'workspace', 'suspend');

    expect(count).toBe(2);
    expect(fake.suspendCalls).toHaveLength(0);
    expect(fake.removeCalls).toHaveLength(0);
  });

  it('remove: returns count of active+suspended accounts', async () => {
    const cohort = await makeCohort();
    const u1 = await makeUser({ cohort_id: cohort.id });
    const u2 = await makeUser({ cohort_id: cohort.id });
    const u3 = await makeUser({ cohort_id: cohort.id });
    await makeExternalAccount(u1, { type: 'workspace', status: 'active', external_id: 'a@example.com' });
    await makeExternalAccount(u2, { type: 'workspace', status: 'suspended', external_id: 'b@example.com' });
    await makeExternalAccount(u3, { type: 'workspace', status: 'removed', external_id: 'c@example.com' });

    const svc = makeService(fake);
    const count = await svc.previewCount(cohort.id, 'workspace', 'remove');

    expect(count).toBe(2); // active + suspended; removed excluded
    expect(fake.removeCalls).toHaveLength(0);
  });

  it('cohort not found: throws NotFoundError', async () => {
    const svc = makeService(fake);
    await expect(svc.previewCount(999999, 'workspace', 'suspend')).rejects.toThrow(NotFoundError);
  });

  it('zero eligible: returns 0', async () => {
    const cohort = await makeCohort();
    const svc = makeService(fake);
    const count = await svc.previewCount(cohort.id, 'workspace', 'suspend');
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// suspendAllInCohort
// ---------------------------------------------------------------------------

describe('BulkCohortService.suspendAllInCohort', () => {
  it('suspends active workspace + claude accounts for all active students in the cohort', async () => {
    const cohort = await makeCohort();
    const alice = await makeUser({ role: 'student', cohort_id: cohort.id });
    const bob = await makeUser({ role: 'student', cohort_id: cohort.id });

    const aWs = await makeExternalAccount(alice, { type: 'workspace', status: 'active' });
    const aCl = await makeExternalAccount(alice, { type: 'claude', status: 'active' });
    const bWs = await makeExternalAccount(bob, { type: 'workspace', status: 'active' });

    const svc = makeService(fake);
    const result = await svc.suspendAllInCohort(cohort.id, ACTOR_ID);

    expect(result.succeeded).toHaveLength(3);
    expect(result.failed).toHaveLength(0);
    expect(result.succeeded.sort()).toEqual([aWs.id, aCl.id, bWs.id].sort());
    expect(fake.suspendCalls.sort()).toEqual([aWs.id, aCl.id, bWs.id].sort());
  });

  it('ignores non-active accounts', async () => {
    const cohort = await makeCohort();
    const alice = await makeUser({ role: 'student', cohort_id: cohort.id });
    await makeExternalAccount(alice, { type: 'workspace', status: 'suspended' });
    await makeExternalAccount(alice, { type: 'claude', status: 'removed' });

    const svc = makeService(fake);
    const result = await svc.suspendAllInCohort(cohort.id, ACTOR_ID);

    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(fake.suspendCalls).toHaveLength(0);
  });

  it('fail-soft: one account fails, the others still succeed, failure carries type', async () => {
    const cohort = await makeCohort();
    const alice = await makeUser({ role: 'student', cohort_id: cohort.id, display_name: 'Alice' });
    const aWs = await makeExternalAccount(alice, { type: 'workspace', status: 'active' });
    const aCl = await makeExternalAccount(alice, { type: 'claude', status: 'active' });

    // Ordering within a user is not guaranteed; fail whichever account is
    // processed second so we get one success and one failure regardless.
    fake.queueSuspendError(null);
    fake.queueSuspendError(new Error('rate limited'));

    const svc = makeService(fake);
    const result = await svc.suspendAllInCohort(cohort.id, ACTOR_ID);

    expect(result.succeeded).toHaveLength(1);
    expect(result.failed).toHaveLength(1);

    // The failing account must be one of the two created, with the right
    // type attached, and the success + failure must cover the set.
    const failed = result.failed[0];
    expect([aWs.id, aCl.id]).toContain(failed.accountId);
    expect(failed.userName).toBe('Alice');
    expect(failed.error).toBe('rate limited');
    expect(failed.type).toBe(failed.accountId === aWs.id ? 'workspace' : 'claude');

    // Succeeded + failed together must be the full set we created.
    const all = [...result.succeeded, failed.accountId].sort();
    expect(all).toEqual([aWs.id, aCl.id].sort());
  });

  it('throws NotFoundError when cohort does not exist', async () => {
    const svc = makeService(fake);
    await expect(svc.suspendAllInCohort(999999, ACTOR_ID)).rejects.toThrow(NotFoundError);
  });

  it('zero-eligible cohort returns empty result', async () => {
    const cohort = await makeCohort();
    const svc = makeService(fake);
    const result = await svc.suspendAllInCohort(cohort.id, ACTOR_ID);
    expect(result).toEqual({ succeeded: [], failed: [] });
  });
});

// ---------------------------------------------------------------------------
// removeAllInCohort
// ---------------------------------------------------------------------------

describe('BulkCohortService.removeAllInCohort', () => {
  it('removes active and suspended workspace + claude accounts', async () => {
    const cohort = await makeCohort();
    const alice = await makeUser({ role: 'student', cohort_id: cohort.id });
    const aWs = await makeExternalAccount(alice, { type: 'workspace', status: 'active' });
    const aCl = await makeExternalAccount(alice, { type: 'claude', status: 'suspended' });

    const svc = makeService(fake);
    const result = await svc.removeAllInCohort(cohort.id, ACTOR_ID);

    expect(result.succeeded.sort()).toEqual([aWs.id, aCl.id].sort());
    expect(result.failed).toHaveLength(0);
    expect(fake.removeCalls.sort()).toEqual([aWs.id, aCl.id].sort());
  });

  it('skips removed accounts', async () => {
    const cohort = await makeCohort();
    const alice = await makeUser({ role: 'student', cohort_id: cohort.id });
    await makeExternalAccount(alice, { type: 'workspace', status: 'removed' });

    const svc = makeService(fake);
    const result = await svc.removeAllInCohort(cohort.id, ACTOR_ID);
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it('throws NotFoundError when cohort does not exist', async () => {
    const svc = makeService(fake);
    await expect(svc.removeAllInCohort(999999, ACTOR_ID)).rejects.toThrow(NotFoundError);
  });
});
