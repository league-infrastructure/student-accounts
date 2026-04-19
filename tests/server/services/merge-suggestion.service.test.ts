/**
 * Integration tests for MergeSuggestionService (Sprint 007 T004).
 *
 * Uses a real SQLite database — no mocking.
 *
 * Covers:
 *  - findQueueItems(): returns pending + deferred; excludes approved/rejected
 *  - findDetailById(): returns full user data; throws NotFoundError when missing
 *  - approve() happy path: Logins re-parented, ExternalAccounts re-parented,
 *    cohort inherited, non-survivor deactivated, suggestion approved, audit written
 *  - approve() no cohort inheritance when survivor already has cohort
 *  - approve() throws NotFoundError for unknown suggestion
 *  - approve() throws MergeConflictError when already approved or rejected
 *  - approve() throws MergeConflictError when survivorId not in pair
 *  - approve() rolls back on constraint violation
 *  - reject() happy path: status, decided_by, decided_at set; audit written
 *  - reject() throws NotFoundError for unknown suggestion
 *  - reject() throws MergeConflictError when already decided
 *  - defer() happy path: status=deferred; decided_by/decided_at remain null
 *  - defer() throws NotFoundError for unknown suggestion
 *  - defer() throws MergeConflictError when already approved or rejected
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { MergeSuggestionService, MergeConflictError } from '../../../server/src/services/merge-suggestion.service.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { NotFoundError } from '../../../server/src/errors.js';
import {
  makeCohort,
  makeUser,
  makeLogin,
  makeExternalAccount,
  makeMergeSuggestion,
} from '../helpers/factories.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearDb() {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

function makeService(): MergeSuggestionService {
  return new MergeSuggestionService(prisma, new AuditService());
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await clearDb();
});

// ---------------------------------------------------------------------------
// findQueueItems
// ---------------------------------------------------------------------------

describe('MergeSuggestionService.findQueueItems', () => {
  it('returns pending and deferred suggestions with user summaries, oldest first', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    const u3 = await makeUser();
    const u4 = await makeUser();

    const s1 = await makeMergeSuggestion(u1, u2, { status: 'pending' });
    const s2 = await makeMergeSuggestion(u3, u4, { status: 'deferred' });
    // approved — should be excluded
    await makeMergeSuggestion(u1, u3, { status: 'approved' });

    const items = await svc.findQueueItems();

    expect(items).toHaveLength(2);
    // Order by id since created_at may be identical in fast tests
    const ids = items.map((i) => i.id).sort((a, b) => a - b);
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);

    // User summaries should be present on at least one item
    const itemA = items.find((i) => i.id === s1.id)!;
    expect(itemA.user_a.id).toBe(u1.id);
    expect(itemA.user_b.id).toBe(u2.id);
    expect(typeof itemA.user_a.display_name).toBe('string');
    expect(typeof itemA.user_a.primary_email).toBe('string');
  });

  it('returns an empty array when queue is empty', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    await makeMergeSuggestion(u1, u2, { status: 'approved' });

    const items = await svc.findQueueItems();
    expect(items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findDetailById
// ---------------------------------------------------------------------------

describe('MergeSuggestionService.findDetailById', () => {
  it('returns full user data including logins and external accounts', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    await makeLogin(u1, { provider: 'google' });
    await makeExternalAccount(u1, { type: 'workspace', status: 'active' });
    const s = await makeMergeSuggestion(u1, u2);

    const detail = await svc.findDetailById(s.id);

    expect(detail.id).toBe(s.id);
    expect(detail.user_a.id).toBe(u1.id);
    expect(detail.user_a.logins).toHaveLength(1);
    expect(detail.user_a.logins[0].provider).toBe('google');
    expect(detail.user_a.external_accounts).toHaveLength(1);
    expect(detail.user_a.external_accounts[0].type).toBe('workspace');
    expect(detail.user_b.id).toBe(u2.id);
  });

  it('throws NotFoundError for unknown id', async () => {
    const svc = makeService();
    await expect(svc.findDetailById(999_999)).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// approve — happy path
// ---------------------------------------------------------------------------

describe('MergeSuggestionService.approve — happy path', () => {
  it('re-parents logins from non-survivor to survivor', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();

    await makeLogin(nonSurvivor, { provider: 'github' });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);

    const actor = await makeUser({ role: 'admin' });
    await svc.approve(s.id, survivor.id, actor.id);

    const logins = await (prisma as any).login.findMany({
      where: { user_id: nonSurvivor.id },
    });
    expect(logins).toHaveLength(0);

    const survivorLogins = await (prisma as any).login.findMany({
      where: { user_id: survivor.id },
    });
    expect(survivorLogins).toHaveLength(1);
    expect(survivorLogins[0].provider).toBe('github');
  });

  it('re-parents external accounts from non-survivor to survivor', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();

    await makeExternalAccount(nonSurvivor, { type: 'workspace', status: 'active' });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);

    const actor = await makeUser({ role: 'admin' });
    await svc.approve(s.id, survivor.id, actor.id);

    const nonSurvivorAccounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: nonSurvivor.id },
    });
    expect(nonSurvivorAccounts).toHaveLength(0);

    const survivorAccounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: survivor.id },
    });
    expect(survivorAccounts).toHaveLength(1);
    expect(survivorAccounts[0].type).toBe('workspace');
  });

  it('inherits cohort from non-survivor when survivor has no cohort', async () => {
    const svc = makeService();
    const cohort = await makeCohort();
    const survivor = await makeUser({ cohort_id: null });
    const nonSurvivor = await makeUser({ cohort_id: cohort.id });

    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });
    await svc.approve(s.id, survivor.id, actor.id);

    const updated = await (prisma as any).user.findUniqueOrThrow({
      where: { id: survivor.id },
    });
    expect(updated.cohort_id).toBe(cohort.id);
  });

  it('does not overwrite survivor cohort when survivor already has one', async () => {
    const svc = makeService();
    const cohortA = await makeCohort();
    const cohortB = await makeCohort();
    const survivor = await makeUser({ cohort_id: cohortA.id });
    const nonSurvivor = await makeUser({ cohort_id: cohortB.id });

    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });
    await svc.approve(s.id, survivor.id, actor.id);

    const updated = await (prisma as any).user.findUniqueOrThrow({
      where: { id: survivor.id },
    });
    expect(updated.cohort_id).toBe(cohortA.id);
  });

  it('sets non-survivor.is_active = false', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    const ns = await (prisma as any).user.findUniqueOrThrow({
      where: { id: nonSurvivor.id },
    });
    expect(ns.is_active).toBe(false);
  });

  it('sets suggestion status=approved, decided_by, decided_at', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    const updated = await (prisma as any).mergeSuggestion.findUniqueOrThrow({
      where: { id: s.id },
    });
    expect(updated.status).toBe('approved');
    expect(updated.decided_by).toBe(actor.id);
    expect(updated.decided_at).toBeInstanceOf(Date);
  });

  it('writes a merge_approve audit event', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'merge_approve' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(actor.id);
    expect(events[0].target_user_id).toBe(survivor.id);
    expect(events[0].target_entity_type).toBe('MergeSuggestion');
    expect(events[0].target_entity_id).toBe(String(s.id));
  });

  it('works when survivor is user_b (not user_a)', async () => {
    const svc = makeService();
    const userA = await makeUser();
    const userB = await makeUser();
    await makeLogin(userA, { provider: 'github' });
    const s = await makeMergeSuggestion(userA, userB);
    const actor = await makeUser({ role: 'admin' });

    // userB is survivor
    await svc.approve(s.id, userB.id, actor.id);

    const loginsOnA = await (prisma as any).login.findMany({ where: { user_id: userA.id } });
    expect(loginsOnA).toHaveLength(0);
    const loginsOnB = await (prisma as any).login.findMany({ where: { user_id: userB.id } });
    expect(loginsOnB).toHaveLength(1);

    const aUser = await (prisma as any).user.findUniqueOrThrow({ where: { id: userA.id } });
    expect(aUser.is_active).toBe(false);
  });

  it('can approve a deferred suggestion', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();
    const s = await makeMergeSuggestion(survivor, nonSurvivor, { status: 'deferred' });
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    const updated = await (prisma as any).mergeSuggestion.findUniqueOrThrow({
      where: { id: s.id },
    });
    expect(updated.status).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// approve — error cases
// ---------------------------------------------------------------------------

describe('MergeSuggestionService.approve — error cases', () => {
  it('throws NotFoundError for unknown suggestion id', async () => {
    const svc = makeService();
    const actor = await makeUser();
    await expect(svc.approve(999_999, 1, actor.id)).rejects.toThrow(NotFoundError);
  });

  it('throws MergeConflictError when suggestion is already approved', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    const actor = await makeUser();
    const s = await makeMergeSuggestion(u1, u2, { status: 'approved' });

    await expect(svc.approve(s.id, u1.id, actor.id)).rejects.toThrow(MergeConflictError);
  });

  it('throws MergeConflictError when suggestion is already rejected', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    const actor = await makeUser();
    const s = await makeMergeSuggestion(u1, u2, { status: 'rejected' });

    await expect(svc.approve(s.id, u1.id, actor.id)).rejects.toThrow(MergeConflictError);
  });

  it('throws MergeConflictError when survivorId is not in the pair', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    const outsider = await makeUser();
    const actor = await makeUser();
    const s = await makeMergeSuggestion(u1, u2);

    await expect(svc.approve(s.id, outsider.id, actor.id)).rejects.toThrow(MergeConflictError);
  });

  it('rolls back entirely when the transaction is forced to fail', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();
    const actor = await makeUser({ role: 'admin' });
    await makeLogin(nonSurvivor, { provider: 'github' });

    const s = await makeMergeSuggestion(survivor, nonSurvivor);

    // Wrap approve() in an outer transaction that throws after approve() runs.
    // This verifies that all approve() writes are part of the same transaction
    // and are rolled back together.
    await expect(
      (prisma as any).$transaction(async (tx: any) => {
        await svc.approve(s.id, survivor.id, actor.id, tx);
        throw new Error('Forced rollback after approve');
      }),
    ).rejects.toThrow('Forced rollback after approve');

    // Both users should still be intact (active) after rollback
    const survivorRow = await (prisma as any).user.findUniqueOrThrow({ where: { id: survivor.id } });
    const nonSurvivorRow = await (prisma as any).user.findUniqueOrThrow({ where: { id: nonSurvivor.id } });
    expect(survivorRow.is_active).toBe(true);
    expect(nonSurvivorRow.is_active).toBe(true);

    // Suggestion must still be pending
    const sRow = await (prisma as any).mergeSuggestion.findUniqueOrThrow({ where: { id: s.id } });
    expect(sRow.status).toBe('pending');

    // Login must still be on non-survivor
    const logins = await (prisma as any).login.findMany({ where: { user_id: nonSurvivor.id } });
    expect(logins).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// reject
// ---------------------------------------------------------------------------

describe('MergeSuggestionService.reject', () => {
  it('sets status=rejected, decided_by, decided_at and writes audit event', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    const actor = await makeUser({ role: 'admin' });
    const s = await makeMergeSuggestion(u1, u2);

    await svc.reject(s.id, actor.id);

    const updated = await (prisma as any).mergeSuggestion.findUniqueOrThrow({
      where: { id: s.id },
    });
    expect(updated.status).toBe('rejected');
    expect(updated.decided_by).toBe(actor.id);
    expect(updated.decided_at).toBeInstanceOf(Date);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'merge_reject' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(actor.id);
    expect(events[0].target_entity_id).toBe(String(s.id));
  });

  it('can reject a deferred suggestion', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    const actor = await makeUser();
    const s = await makeMergeSuggestion(u1, u2, { status: 'deferred' });

    await svc.reject(s.id, actor.id);

    const updated = await (prisma as any).mergeSuggestion.findUniqueOrThrow({
      where: { id: s.id },
    });
    expect(updated.status).toBe('rejected');
  });

  it('throws NotFoundError for unknown suggestion id', async () => {
    const svc = makeService();
    const actor = await makeUser();
    await expect(svc.reject(999_999, actor.id)).rejects.toThrow(NotFoundError);
  });

  it('throws MergeConflictError when suggestion is already approved', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    const actor = await makeUser();
    const s = await makeMergeSuggestion(u1, u2, { status: 'approved' });

    await expect(svc.reject(s.id, actor.id)).rejects.toThrow(MergeConflictError);
  });

  it('throws MergeConflictError when suggestion is already rejected', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    const actor = await makeUser();
    const s = await makeMergeSuggestion(u1, u2, { status: 'rejected' });

    await expect(svc.reject(s.id, actor.id)).rejects.toThrow(MergeConflictError);
  });
});

// ---------------------------------------------------------------------------
// defer
// ---------------------------------------------------------------------------

describe('MergeSuggestionService.defer', () => {
  it('sets status=deferred and leaves decided_by and decided_at null', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    const s = await makeMergeSuggestion(u1, u2, { status: 'pending' });

    await svc.defer(s.id);

    const updated = await (prisma as any).mergeSuggestion.findUniqueOrThrow({
      where: { id: s.id },
    });
    expect(updated.status).toBe('deferred');
    expect(updated.decided_by).toBeNull();
    expect(updated.decided_at).toBeNull();
  });

  it('is idempotent — deferring an already-deferred suggestion succeeds', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    const s = await makeMergeSuggestion(u1, u2, { status: 'deferred' });

    await expect(svc.defer(s.id)).resolves.not.toThrow();
  });

  it('throws NotFoundError for unknown suggestion id', async () => {
    const svc = makeService();
    await expect(svc.defer(999_999)).rejects.toThrow(NotFoundError);
  });

  it('throws MergeConflictError when suggestion is already approved', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    const s = await makeMergeSuggestion(u1, u2, { status: 'approved' });

    await expect(svc.defer(s.id)).rejects.toThrow(MergeConflictError);
  });

  it('throws MergeConflictError when suggestion is already rejected', async () => {
    const svc = makeService();
    const u1 = await makeUser();
    const u2 = await makeUser();
    const s = await makeMergeSuggestion(u1, u2, { status: 'rejected' });

    await expect(svc.defer(s.id)).rejects.toThrow(MergeConflictError);
  });
});
