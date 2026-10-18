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
 *
 * Sprint 002 T008 (merge completeness):
 *  - approve() moves UserGroup (skipping duplicates), LlmProxyToken (moved when
 *    the survivor has none, revoked with usage carried otherwise), username +
 *    hashes (taken when the survivor has none, dropped and recorded otherwise),
 *    ORs allows_* flags, resolves ExternalAccount conflicts, re-points OAuth
 *    rows, provisioning requests and audit rows, parks the non-survivor's email
 *  - the merge_approve payload lists everything; reconcile() runs after commit
 *  - findDetailById() carries username / created_via / created_host / token / groups
 *  - manualMerge(): validation, admin-initiated suggestion, approval
 *  - rescan(): rule backfill
 */
import { prisma } from '../../../server/src/services/prisma.js';
import {
  MergeSuggestionService,
  MergeConflictError,
  ADMIN_INITIATED_RATIONALE,
  parkedEmail,
} from '../../../server/src/services/merge-suggestion.service.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { AppError, ConflictError, NotFoundError } from '../../../server/src/errors.js';
import {
  makeCohort,
  makeUser,
  makeLogin,
  makeExternalAccount,
  makeMergeSuggestion,
  makeGroup,
  makeMembership,
  makeProvisioningRequest,
  makeAuditEvent,
} from '../helpers/factories.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearDb() {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).oAuthConsent.deleteMany();
  await (prisma as any).oAuthAccessToken.deleteMany();
  await (prisma as any).oAuthRefreshToken.deleteMany();
  await (prisma as any).oAuthAuthorizationCode.deleteMany();
  await (prisma as any).oAuthClient.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

/** Records reconcile() calls in place of LaptopAccountService. */
function fakeLaptopAccounts() {
  const calls: Array<{ userId: number; actorId: number | null }> = [];
  return {
    calls,
    reconcile: async (userId: number, actorId: number | null = null) => {
      calls.push({ userId, actorId });
      return 'written' as const;
    },
  };
}

function makeService(laptopAccounts?: ReturnType<typeof fakeLaptopAccounts>): MergeSuggestionService {
  return new MergeSuggestionService(prisma, new AuditService(), laptopAccounts ?? null);
}

let tokenSeq = 0;
async function makeToken(
  userId: number,
  overrides: Partial<{
    tokens_used: number;
    request_count: number;
    token_limit: number;
    revoked_at: Date | null;
    expires_at: Date;
  }> = {},
) {
  tokenSeq++;
  return (prisma as any).llmProxyToken.create({
    data: {
      user_id: userId,
      token_hash: `hash-${userId}-${tokenSeq}-${Date.now()}`,
      token_plaintext: `llmp_${userId}_${tokenSeq}`,
      expires_at: new Date(Date.now() + 86_400_000),
      token_limit: 100_000,
      ...overrides,
    },
  });
}

let clientSeq = 0;
async function makeOAuthClient() {
  clientSeq++;
  return (prisma as any).oAuthClient.create({
    data: {
      client_id: `client-${clientSeq}-${Date.now()}`,
      client_secret_hash: 'x',
      name: `Client ${clientSeq}`,
      redirect_uris: ['https://example.com/cb'],
      allowed_scopes: ['profile'],
    },
  });
}

async function user(id: number) {
  return (prisma as any).user.findUniqueOrThrow({ where: { id } });
}

async function mergeApproveDetails(): Promise<any> {
  const events = await (prisma as any).auditEvent.findMany({ where: { action: 'merge_approve' } });
  expect(events).toHaveLength(1);
  return events[0].details;
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

// ---------------------------------------------------------------------------
// approve — completeness (sprint 002 T008)
// ---------------------------------------------------------------------------

describe('MergeSuggestionService.approve — moves everything (T008)', () => {
  it('moves group memberships and skips the ones the survivor already has', async () => {
    const svc = makeService();
    const shared = await makeGroup({ name: 'Botball 26' });
    const only = await makeGroup({ name: 'Robotics' });
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();
    await makeMembership(shared, survivor);
    await makeMembership(shared, nonSurvivor);
    await makeMembership(only, nonSurvivor);
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    const survivorGroups = await (prisma as any).userGroup.findMany({ where: { user_id: survivor.id } });
    expect(survivorGroups.map((g: any) => g.group_id).sort()).toEqual([shared.id, only.id].sort());
    expect(await (prisma as any).userGroup.count({ where: { user_id: nonSurvivor.id } })).toBe(0);

    const details = await mergeApproveDetails();
    expect(details.groups_moved).toEqual(['Robotics']);
    expect(details.groups_skipped).toEqual(['Botball 26']);
  });

  it('moves the non-survivor active proxy token when the survivor has none', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();
    const token = await makeToken(nonSurvivor.id, { tokens_used: 500, request_count: 7 });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    const moved = await (prisma as any).llmProxyToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(moved.user_id).toBe(survivor.id);
    expect(moved.revoked_at).toBeNull();
    expect(moved.tokens_used).toBe(500);

    const details = await mergeApproveDetails();
    expect(details.llm_proxy_token).toBe('moved');
    expect(details.llm_proxy_usage_carried).toBeNull();
  });

  it('revokes the non-survivor token and carries usage when the survivor has one', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();
    const keep = await makeToken(survivor.id, { tokens_used: 10_000, request_count: 40 });
    const lose = await makeToken(nonSurvivor.id, { tokens_used: 2_500, request_count: 9 });
    // A long-revoked historical token on the non-survivor is re-pointed too.
    const old = await makeToken(nonSurvivor.id, { revoked_at: new Date(Date.now() - 1000) });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    const kept = await (prisma as any).llmProxyToken.findUniqueOrThrow({ where: { id: keep.id } });
    expect(kept.user_id).toBe(survivor.id);
    expect(kept.revoked_at).toBeNull();
    expect(kept.tokens_used).toBe(12_500);
    expect(kept.request_count).toBe(49);

    const revoked = await (prisma as any).llmProxyToken.findUniqueOrThrow({ where: { id: lose.id } });
    expect(revoked.revoked_at).toBeInstanceOf(Date);
    expect(revoked.user_id).toBe(survivor.id);
    const oldRow = await (prisma as any).llmProxyToken.findUniqueOrThrow({ where: { id: old.id } });
    expect(oldRow.user_id).toBe(survivor.id);

    // Exactly one active token on the survivor.
    const active = await (prisma as any).llmProxyToken.findMany({
      where: { user_id: survivor.id, revoked_at: null, expires_at: { gt: new Date() } },
    });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(keep.id);

    const details = await mergeApproveDetails();
    expect(details.llm_proxy_token).toBe('revoked');
    expect(details.llm_proxy_usage_carried).toEqual({ tokens_used: 2_500, request_count: 9 });
    expect(details.llm_proxy_tokens_repointed).toBe(2);
  });

  it('takes username, password_hash and laptop_password_hash when the survivor has none', async () => {
    const svc = makeService();
    const survivor = await makeUser({ username: null, password_hash: null, laptop_password_hash: null });
    const nonSurvivor = await makeUser({
      username: 'alice',
      password_hash: 'scrypt$abc',
      laptop_password_hash: '$6$salt$hash',
    });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    const sv = await user(survivor.id);
    expect(sv.username).toBe('alice');
    expect(sv.password_hash).toBe('scrypt$abc');
    expect(sv.laptop_password_hash).toBe('$6$salt$hash');
    const ns = await user(nonSurvivor.id);
    expect(ns.username).toBeNull();

    const details = await mergeApproveDetails();
    expect(details.username).toEqual({ taken: 'alice' });
    expect(details.password_hash_taken).toBe(true);
    expect(details.laptop_password_hash_taken).toBe(true);
  });

  it('keeps the survivor credentials and records the dropped username when both have one', async () => {
    const svc = makeService();
    const survivor = await makeUser({
      username: 'alice',
      password_hash: 'scrypt$alice',
      laptop_password_hash: '$6$alice',
    });
    const nonSurvivor = await makeUser({
      username: 'bob',
      password_hash: 'scrypt$bob',
      laptop_password_hash: '$6$bob',
    });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    const sv = await user(survivor.id);
    expect(sv.username).toBe('alice');
    expect(sv.password_hash).toBe('scrypt$alice');
    expect(sv.laptop_password_hash).toBe('$6$alice');
    // The dropped username stays on the inactive row so its roster entry can be locked.
    const ns = await user(nonSurvivor.id);
    expect(ns.username).toBe('bob');
    expect(ns.is_active).toBe(false);

    const details = await mergeApproveDetails();
    expect(details.username).toEqual({ dropped: 'bob', kept: 'alice' });
    expect(details.password_hash_taken).toBe(false);
  });

  it('ORs the allows_* flags into the survivor', async () => {
    const svc = makeService();
    const survivor = await makeUser({
      allows_oauth_client: false,
      allows_llm_proxy: true,
      allows_league_account: false,
      allows_laptop_account: false,
    });
    const nonSurvivor = await makeUser({
      allows_oauth_client: true,
      allows_llm_proxy: false,
      allows_league_account: false,
      allows_laptop_account: true,
    });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    const sv = await user(survivor.id);
    expect(sv.allows_oauth_client).toBe(true);
    expect(sv.allows_llm_proxy).toBe(true);
    expect(sv.allows_league_account).toBe(false);
    expect(sv.allows_laptop_account).toBe(true);

    const details = await mergeApproveDetails();
    expect(details.flags_set.sort()).toEqual(['allows_laptop_account', 'allows_oauth_client']);
  });

  it('marks a conflicting live external account removed instead of tripping the unique index', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();
    const keep = await makeExternalAccount(survivor, { type: 'workspace', status: 'active' });
    const clash = await makeExternalAccount(nonSurvivor, { type: 'workspace', status: 'pending' });
    const other = await makeExternalAccount(nonSurvivor, { type: 'claude', status: 'active' });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    const rows = await (prisma as any).externalAccount.findMany({
      where: { user_id: survivor.id },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((r: any) => r.id).sort()).toEqual([keep.id, clash.id, other.id].sort());
    const clashRow = rows.find((r: any) => r.id === clash.id);
    expect(clashRow.status).toBe('removed');
    expect(clashRow.status_changed_at).toBeInstanceOf(Date);
    expect(rows.find((r: any) => r.id === keep.id).status).toBe('active');
    expect(rows.find((r: any) => r.id === other.id).status).toBe('active');

    const details = await mergeApproveDetails();
    expect(details.external_accounts_moved).toBe(2);
    expect(details.external_accounts_removed).toEqual([{ id: clash.id, type: 'workspace' }]);
  });

  it('re-points OAuth consents, tokens and codes, dropping a duplicate consent', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();
    const clientA = await makeOAuthClient();
    const clientB = await makeOAuthClient();
    await (prisma as any).oAuthConsent.create({
      data: { user_id: survivor.id, oauth_client_id: clientA.id, scopes: ['profile'] },
    });
    await (prisma as any).oAuthConsent.create({
      data: { user_id: nonSurvivor.id, oauth_client_id: clientA.id, scopes: ['profile'] },
    });
    await (prisma as any).oAuthConsent.create({
      data: { user_id: nonSurvivor.id, oauth_client_id: clientB.id, scopes: ['profile'] },
    });
    const access = await (prisma as any).oAuthAccessToken.create({
      data: {
        oauth_client_id: clientA.id,
        user_id: nonSurvivor.id,
        token_hash: `at-${Date.now()}`,
        scopes: ['profile'],
        expires_at: new Date(Date.now() + 3600_000),
      },
    });
    const refresh = await (prisma as any).oAuthRefreshToken.create({
      data: {
        oauth_client_id: clientA.id,
        user_id: nonSurvivor.id,
        token_hash: `rt-${Date.now()}`,
        scopes: ['profile'],
        expires_at: new Date(Date.now() + 3600_000),
      },
    });
    const code = await (prisma as any).oAuthAuthorizationCode.create({
      data: {
        oauth_client_id: clientA.id,
        user_id: nonSurvivor.id,
        code_hash: `code-${Date.now()}`,
        redirect_uri: 'https://example.com/cb',
        scopes: ['profile'],
        code_challenge: 'c',
        code_challenge_method: 'S256',
        expires_at: new Date(Date.now() + 600_000),
      },
    });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    const consents = await (prisma as any).oAuthConsent.findMany({ where: { user_id: survivor.id } });
    expect(consents.map((c: any) => c.oauth_client_id).sort()).toEqual([clientA.id, clientB.id].sort());
    expect(await (prisma as any).oAuthConsent.count({ where: { user_id: nonSurvivor.id } })).toBe(0);
    expect((await (prisma as any).oAuthAccessToken.findUniqueOrThrow({ where: { id: access.id } })).user_id).toBe(survivor.id);
    expect((await (prisma as any).oAuthRefreshToken.findUniqueOrThrow({ where: { id: refresh.id } })).user_id).toBe(survivor.id);
    expect((await (prisma as any).oAuthAuthorizationCode.findUniqueOrThrow({ where: { id: code.id } })).user_id).toBe(survivor.id);

    const details = await mergeApproveDetails();
    expect(details.oauth_consents_moved).toBe(1);
    expect(details.oauth_consents_dropped).toBe(1);
    expect(details.oauth_access_tokens_moved).toBe(1);
    expect(details.oauth_refresh_tokens_moved).toBe(1);
    expect(details.oauth_authorization_codes_moved).toBe(1);
  });

  it('re-points provisioning requests (requester and decider) and audit actor/target rows', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();
    const third = await makeUser();
    const requested = await makeProvisioningRequest(nonSurvivor);
    const decided = await makeProvisioningRequest(third, {
      status: 'approved',
      decided_by: nonSurvivor.id,
      decided_at: new Date(),
    });
    const asActor = await makeAuditEvent({ actor_user_id: nonSurvivor.id, action: 'add_login' });
    const asTarget = await makeAuditEvent({ target_user_id: nonSurvivor.id, action: 'create_user' });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    expect((await (prisma as any).provisioningRequest.findUniqueOrThrow({ where: { id: requested.id } })).user_id).toBe(survivor.id);
    expect((await (prisma as any).provisioningRequest.findUniqueOrThrow({ where: { id: decided.id } })).decided_by).toBe(survivor.id);
    expect((await (prisma as any).auditEvent.findUniqueOrThrow({ where: { id: asActor.id } })).actor_user_id).toBe(survivor.id);
    expect((await (prisma as any).auditEvent.findUniqueOrThrow({ where: { id: asTarget.id } })).target_user_id).toBe(survivor.id);

    const details = await mergeApproveDetails();
    expect(details.provisioning_requests_moved).toBe(1);
    expect(details.provisioning_decisions_moved).toBe(1);
    expect(details.audit_events_repointed).toEqual({ actor: 1, target: 1 });
  });

  it('parks the non-survivor email as merged:<survivorId>:<email> and records merged_into', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser({ primary_email: 'bob@example.com' });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    const ns = await user(nonSurvivor.id);
    expect(ns.primary_email).toBe(`merged:${survivor.id}:bob@example.com`);
    expect(ns.primary_email).toBe(parkedEmail(survivor.id, 'bob@example.com'));
    expect(ns.is_active).toBe(false);

    // The real address is free again.
    const again = await makeUser({ primary_email: 'bob@example.com' });
    expect(again.id).toBeGreaterThan(nonSurvivor.id);

    const details = await mergeApproveDetails();
    expect(details.merged_into).toBe(survivor.id);
    expect(details.parked_email).toBe(`merged:${survivor.id}:bob@example.com`);
    expect(details.non_survivor_id).toBe(nonSurvivor.id);
    expect(details.logins_moved).toBe(0);
  });

  it('reconciles the laptop roster for the survivor and the non-survivor after commit', async () => {
    const laptop = fakeLaptopAccounts();
    const svc = makeService(laptop);
    const survivor = await makeUser();
    const nonSurvivor = await makeUser({ username: 'bob', laptop_password_hash: '$6$bob' });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    expect(laptop.calls).toEqual([
      { userId: survivor.id, actorId: actor.id },
      { userId: nonSurvivor.id, actorId: actor.id },
    ]);
  });

  it('reconciles only the survivor when the non-survivor had no username', async () => {
    const laptop = fakeLaptopAccounts();
    const svc = makeService(laptop);
    const survivor = await makeUser();
    const nonSurvivor = await makeUser();
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await svc.approve(s.id, survivor.id, actor.id);

    expect(laptop.calls).toEqual([{ userId: survivor.id, actorId: actor.id }]);
  });

  it('does not reconcile when the caller owns the transaction', async () => {
    const laptop = fakeLaptopAccounts();
    const svc = makeService(laptop);
    const survivor = await makeUser();
    const nonSurvivor = await makeUser({ username: 'bob' });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    await (prisma as any).$transaction(async (tx: any) => {
      await svc.approve(s.id, survivor.id, actor.id, tx);
    });

    expect(laptop.calls).toEqual([]);
  });

  it('returns the outcome and the audit payload equals it', async () => {
    const svc = makeService();
    const survivor = await makeUser();
    const nonSurvivor = await makeUser({ username: 'bob' });
    await makeLogin(nonSurvivor, { provider: 'github' });
    const s = await makeMergeSuggestion(survivor, nonSurvivor);
    const actor = await makeUser({ role: 'admin' });

    const outcome = await svc.approve(s.id, survivor.id, actor.id);

    expect(outcome.logins_moved).toBe(1);
    expect(outcome.username).toEqual({ taken: 'bob' });
    const details = await mergeApproveDetails();
    expect(details).toEqual(JSON.parse(JSON.stringify(outcome)));
  });
});

// ---------------------------------------------------------------------------
// findDetailById — T008 fields
// ---------------------------------------------------------------------------

describe('MergeSuggestionService.findDetailById — T008 fields', () => {
  it('carries username, created_via, created_host, active token summary and group names', async () => {
    const svc = makeService();
    const laptop = await makeUser({ username: 'alice', created_via: 'laptop_import' as any });
    await (prisma as any).login.create({
      data: {
        user_id: laptop.id,
        provider: 'username',
        provider_user_id: `laptop-import:alice`,
        provider_username: 'alice',
        provider_payload: { created: '20260825T170542Z', created_host: 'jtl-inspiron-ABC123' },
      },
    });
    const google = await makeUser();
    await makeLogin(google, { provider: 'google' });
    await makeToken(google.id, { tokens_used: 1234, token_limit: 50_000 });
    await makeToken(google.id, { revoked_at: new Date() }); // revoked: ignored
    const g1 = await makeGroup({ name: 'Botball 26' });
    const g2 = await makeGroup({ name: 'Robotics' });
    await makeMembership(g1, laptop);
    await makeMembership(g2, google);
    const s = await makeMergeSuggestion(laptop, google);

    const detail = await svc.findDetailById(s.id);

    expect(detail.user_a).toMatchObject({
      id: laptop.id,
      username: 'alice',
      created_via: 'laptop_import',
      created_host: 'jtl-inspiron-ABC123',
      llm_proxy_token: null,
      groups: ['Botball 26'],
      is_active: true,
    });
    expect(detail.user_b).toMatchObject({
      id: google.id,
      username: null,
      created_via: 'admin_created',
      created_host: null,
      llm_proxy_token: { tokens_used: 1234, token_limit: 50_000 },
      groups: ['Robotics'],
    });
    expect(detail.user_b.logins[0].provider).toBe('google');
  });
});

// ---------------------------------------------------------------------------
// manualMerge
// ---------------------------------------------------------------------------

describe('MergeSuggestionService.manualMerge', () => {
  it('creates an admin-initiated suggestion and approves it with the chosen survivor', async () => {
    const laptop = fakeLaptopAccounts();
    const svc = makeService(laptop);
    const a = await makeUser();
    const b = await makeUser({ username: 'bob' });
    await makeLogin(b, { provider: 'github' });
    const actor = await makeUser({ role: 'admin' });

    const outcome = await svc.manualMerge(a.id, b.id, a.id, actor.id);

    expect(outcome.survivor_id).toBe(a.id);
    expect(outcome.username).toEqual({ taken: 'bob' });
    const suggestion = await (prisma as any).mergeSuggestion.findUniqueOrThrow({
      where: { user_a_id_user_b_id: { user_a_id: Math.min(a.id, b.id), user_b_id: Math.max(a.id, b.id) } },
    });
    expect(suggestion.status).toBe('approved');
    expect(suggestion.haiku_rationale).toBe(ADMIN_INITIATED_RATIONALE);
    expect(suggestion.haiku_confidence).toBe(1.0);
    expect(suggestion.decided_by).toBe(actor.id);

    expect((await user(b.id)).is_active).toBe(false);
    expect(await (prisma as any).login.count({ where: { user_id: a.id } })).toBe(1);
    expect(await (prisma as any).auditEvent.count({ where: { action: 'merge_suggestion_created' } })).toBe(1);
    expect(await (prisma as any).auditEvent.count({ where: { action: 'merge_approve' } })).toBe(1);
    expect(laptop.calls[0]).toEqual({ userId: a.id, actorId: actor.id });
  });

  it('reuses an existing pending suggestion for the pair', async () => {
    const svc = makeService();
    const a = await makeUser();
    const b = await makeUser();
    const existing = await makeMergeSuggestion(a, b, { haiku_confidence: 0.7, haiku_rationale: 'llm' });
    const actor = await makeUser({ role: 'admin' });

    await svc.manualMerge(b.id, a.id, b.id, actor.id);

    const row = await (prisma as any).mergeSuggestion.findUniqueOrThrow({ where: { id: existing.id } });
    expect(row.status).toBe('approved');
    expect(row.haiku_rationale).toBe(ADMIN_INITIATED_RATIONALE);
    expect(await (prisma as any).mergeSuggestion.count()).toBe(1);
    expect((await user(a.id)).is_active).toBe(false);
  });

  it('reuses a rejected suggestion for the pair (the admin overrides the earlier decision)', async () => {
    const svc = makeService();
    const a = await makeUser();
    const b = await makeUser();
    const existing = await makeMergeSuggestion(a, b, { status: 'rejected' });
    const actor = await makeUser({ role: 'admin' });

    await svc.manualMerge(a.id, b.id, a.id, actor.id);

    const row = await (prisma as any).mergeSuggestion.findUniqueOrThrow({ where: { id: existing.id } });
    expect(row.status).toBe('approved');
  });

  it('throws 400 when the survivor is neither user or the users are the same', async () => {
    const svc = makeService();
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const actor = await makeUser({ role: 'admin' });

    await expect(svc.manualMerge(a.id, b.id, c.id, actor.id)).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.manualMerge(a.id, a.id, a.id, actor.id)).rejects.toBeInstanceOf(AppError);
    await expect(svc.manualMerge(a.id, a.id, a.id, actor.id)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws NotFoundError when either user does not exist', async () => {
    const svc = makeService();
    const a = await makeUser();
    const actor = await makeUser({ role: 'admin' });
    await expect(svc.manualMerge(a.id, 999_999, a.id, actor.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.manualMerge(999_999, a.id, a.id, actor.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when either user is inactive or the pair was already merged', async () => {
    const svc = makeService();
    const a = await makeUser();
    const inactive = await makeUser({ is_active: false });
    const actor = await makeUser({ role: 'admin' });
    await expect(svc.manualMerge(a.id, inactive.id, a.id, actor.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.manualMerge(inactive.id, a.id, a.id, actor.id)).rejects.toBeInstanceOf(ConflictError);

    const b = await makeUser();
    const c = await makeUser();
    await makeMergeSuggestion(b, c, { status: 'approved' });
    await expect(svc.manualMerge(b.id, c.id, b.id, actor.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

// ---------------------------------------------------------------------------
// rescan
// ---------------------------------------------------------------------------

describe('MergeSuggestionService.rescan', () => {
  it('creates rule-based suggestions for laptop-imported users and is idempotent', async () => {
    const svc = makeService();
    const google = await makeUser({ primary_email: 'alice@gmail.com', display_name: 'Alice Smith' });
    const imported = await makeUser({
      username: 'alice',
      primary_email: 'alice@laptop.invalid',
      display_name: 'alice',
      created_via: 'laptop_import' as any,
    });
    await makeUser({ primary_email: 'zed@example.com', display_name: 'Zed Zed' });

    const first = await svc.rescan('laptop_import');
    expect(first).toEqual({ scanned: 1, created: 1 });
    const rows = await (prisma as any).mergeSuggestion.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_a_id: Math.min(google.id, imported.id),
      user_b_id: Math.max(google.id, imported.id),
      haiku_confidence: 1.0,
      haiku_rationale: 'same username as email local part',
      status: 'pending',
    });

    const second = await svc.rescan('laptop_import');
    expect(second).toEqual({ scanned: 1, created: 0 });
    expect(await (prisma as any).mergeSuggestion.count()).toBe(1);
  });
});
