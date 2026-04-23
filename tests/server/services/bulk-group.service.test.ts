/**
 * Unit tests for BulkGroupService (Sprint 012 T003).
 *
 * Mirrors the approach in `bulk-cohort.service.test.ts`: uses a fake
 * ExternalAccountLifecycleService and a real SQLite database to verify
 * eligibility scoping (members in, non-members out), fail-soft per
 * account, and the `type`-carrying failure shape for suspend-all /
 * remove-all.
 */

import { prisma } from '../../../server/src/services/prisma.js';
import { BulkGroupService } from '../../../server/src/services/bulk-group.service.js';
import { NotFoundError } from '../../../server/src/errors.js';
import {
  makeUser,
  makeExternalAccount,
  makeGroup,
  makeMembership,
} from '../helpers/factories.js';
import type { ExternalAccount, Prisma } from '../../../server/src/generated/prisma/client.js';

// ---------------------------------------------------------------------------
// Fake ExternalAccountLifecycleService
// ---------------------------------------------------------------------------

class FakeLifecycleService {
  suspendCalls: number[] = [];
  removeCalls: number[] = [];
  private suspendErrors: Array<Error | null> = [];
  private removeErrors: Array<Error | null> = [];

  queueSuspendError(err: Error | null): void {
    this.suspendErrors.push(err);
  }
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
// Fake provisioning services
// ---------------------------------------------------------------------------

class FakeProvisioningService {
  calls: number[] = [];
  private errors: Array<Error | null> = [];
  queueError(err: Error | null) {
    this.errors.push(err);
  }
  reset() {
    this.calls = [];
    this.errors = [];
  }
  async provision(userId: number, _actorId: number, _tx: Prisma.TransactionClient) {
    this.calls.push(userId);
    const e = this.errors.shift() ?? null;
    if (e) throw e;
    return { id: userId, user_id: userId } as any;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearDb() {
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

function makeService(
  fake: FakeLifecycleService,
  workspace?: FakeProvisioningService,
  claude?: FakeProvisioningService,
): BulkGroupService {
  return new BulkGroupService(
    prisma as any,
    fake as any,
    workspace as any,
    claude as any,
  );
}

const ACTOR_ID = 1;
let fake: FakeLifecycleService;

beforeEach(async () => {
  await clearDb();
  fake = new FakeLifecycleService();
});

// ---------------------------------------------------------------------------
// _assertGroupExists — propagates NotFoundError
// ---------------------------------------------------------------------------

describe('BulkGroupService — missing group', () => {
  it('previewCount throws NotFoundError when group missing', async () => {
    const svc = makeService(fake);
    await expect(
      svc.previewCount(99999, 'workspace', 'suspend'),
    ).rejects.toThrow(NotFoundError);
  });

  it('suspendAllInGroup throws NotFoundError when group missing', async () => {
    const svc = makeService(fake);
    await expect(svc.suspendAllInGroup(99999, ACTOR_ID)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('removeAllInGroup throws NotFoundError when group missing', async () => {
    const svc = makeService(fake);
    await expect(svc.removeAllInGroup(99999, ACTOR_ID)).rejects.toThrow(
      NotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// suspendAllInGroup
// ---------------------------------------------------------------------------

describe('BulkGroupService.suspendAllInGroup', () => {
  it('suspends workspace + claude accounts for members, skips non-members', async () => {
    const group = await makeGroup();
    const member = await makeUser();
    const nonMember = await makeUser();
    await makeMembership(group, member);

    const memberWs = await makeExternalAccount(member, {
      type: 'workspace',
      status: 'active',
      external_id: 'member-ws@league',
    });
    const memberCl = await makeExternalAccount(member, {
      type: 'claude',
      status: 'active',
      external_id: 'invite_abc',
    });
    await makeExternalAccount(nonMember, {
      type: 'workspace',
      status: 'active',
      external_id: 'non-member-ws@league',
    });

    const svc = makeService(fake);
    const result = await svc.suspendAllInGroup(group.id, ACTOR_ID);

    expect(new Set(result.succeeded)).toEqual(new Set([memberWs.id, memberCl.id]));
    expect(result.failed.length).toBe(0);
    // Non-member's account is not touched.
    expect(fake.suspendCalls.length).toBe(2);
  });

  it('fail-soft on per-account error and carries type in failure entry', async () => {
    const group = await makeGroup();
    const u = await makeUser({ display_name: 'Soft Fail' });
    await makeMembership(group, u);
    const ws = await makeExternalAccount(u, {
      type: 'workspace',
      status: 'active',
      external_id: 'soft-fail@league',
    });
    const cl = await makeExternalAccount(u, {
      type: 'claude',
      status: 'active',
      external_id: 'invite_sf',
    });

    fake.queueSuspendError(new Error('workspace down'));
    fake.queueSuspendError(null);

    const svc = makeService(fake);
    const result = await svc.suspendAllInGroup(group.id, ACTOR_ID);

    expect(result.succeeded.length).toBe(1);
    expect(result.failed.length).toBe(1);
    const failure = result.failed[0];
    expect(failure.userName).toBe('Soft Fail');
    expect(failure.error).toBe('workspace down');
    expect(['workspace', 'claude']).toContain(failure.type);
    // Both accounts must have been attempted
    expect(new Set([...result.succeeded, ...result.failed.map((f) => f.accountId)])).toEqual(
      new Set([ws.id, cl.id]),
    );
  });

  it('excludes inactive members', async () => {
    const group = await makeGroup();
    const active = await makeUser({ display_name: 'Active' });
    const inactive = await makeUser({ display_name: 'Inactive' });
    await (prisma as any).user.update({
      where: { id: inactive.id },
      data: { is_active: false },
    });
    await makeMembership(group, active);
    await makeMembership(group, inactive);
    await makeExternalAccount(active, {
      type: 'workspace',
      status: 'active',
      external_id: 'a@league',
    });
    await makeExternalAccount(inactive, {
      type: 'workspace',
      status: 'active',
      external_id: 'b@league',
    });

    const svc = makeService(fake);
    const result = await svc.suspendAllInGroup(group.id, ACTOR_ID);
    expect(result.succeeded.length).toBe(1);
  });

  it('returns zero-eligible as all-succeeded', async () => {
    const group = await makeGroup();
    const svc = makeService(fake);
    const result = await svc.suspendAllInGroup(group.id, ACTOR_ID);
    expect(result).toEqual({ succeeded: [], failed: [] });
  });
});

// ---------------------------------------------------------------------------
// removeAllInGroup
// ---------------------------------------------------------------------------

describe('BulkGroupService.removeAllInGroup', () => {
  it('removes active and suspended accounts', async () => {
    const group = await makeGroup();
    const u = await makeUser();
    await makeMembership(group, u);
    const ws = await makeExternalAccount(u, {
      type: 'workspace',
      status: 'active',
      external_id: 'x@league',
    });
    const cl = await makeExternalAccount(u, {
      type: 'claude',
      status: 'suspended',
      external_id: 'invite_x',
    });

    const svc = makeService(fake);
    const result = await svc.removeAllInGroup(group.id, ACTOR_ID);

    expect(new Set(result.succeeded)).toEqual(new Set([ws.id, cl.id]));
    expect(result.failed.length).toBe(0);
    expect(fake.removeCalls.length).toBe(2);
  });

  it('skips removed accounts', async () => {
    const group = await makeGroup();
    const u = await makeUser();
    await makeMembership(group, u);
    await makeExternalAccount(u, {
      type: 'workspace',
      status: 'removed',
      external_id: 'x@league',
    });

    const svc = makeService(fake);
    const result = await svc.removeAllInGroup(group.id, ACTOR_ID);
    expect(result.succeeded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// previewCount
// ---------------------------------------------------------------------------

describe('BulkGroupService.previewCount', () => {
  it('counts active workspace accounts eligible for suspend', async () => {
    const group = await makeGroup();
    const u = await makeUser();
    await makeMembership(group, u);
    await makeExternalAccount(u, {
      type: 'workspace',
      status: 'active',
      external_id: 'p1@league',
    });
    const svc = makeService(fake);
    expect(await svc.previewCount(group.id, 'workspace', 'suspend')).toBe(1);
  });

  it('counts active+suspended claude accounts eligible for remove', async () => {
    const group = await makeGroup();
    const u = await makeUser();
    await makeMembership(group, u);
    await makeExternalAccount(u, {
      type: 'claude',
      status: 'suspended',
      external_id: 'invite_p2',
    });
    const svc = makeService(fake);
    expect(await svc.previewCount(group.id, 'claude', 'remove')).toBe(1);
  });

  it('excludes non-members', async () => {
    const group = await makeGroup();
    const u = await makeUser();
    await makeExternalAccount(u, {
      type: 'workspace',
      status: 'active',
      external_id: 'non@league',
    });
    const svc = makeService(fake);
    expect(await svc.previewCount(group.id, 'workspace', 'suspend')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// provisionGroup
// ---------------------------------------------------------------------------

describe('BulkGroupService.provisionGroup', () => {
  it('provisions workspace accounts for eligible members', async () => {
    const group = await makeGroup();
    const u1 = await makeUser({ display_name: 'U1' });
    const u2 = await makeUser({ display_name: 'U2' });
    await makeMembership(group, u1);
    await makeMembership(group, u2);

    const workspace = new FakeProvisioningService();
    const svc = makeService(fake, workspace);
    const result = await svc.provisionGroup(group.id, 'workspace', ACTOR_ID);
    expect(new Set(result.succeeded)).toEqual(new Set([u1.id, u2.id]));
    expect(workspace.calls.length).toBe(2);
  });

  it('skips members with existing active/pending account of that type', async () => {
    const group = await makeGroup();
    const u1 = await makeUser();
    const u2 = await makeUser();
    await makeMembership(group, u1);
    await makeMembership(group, u2);
    await makeExternalAccount(u1, {
      type: 'workspace',
      status: 'active',
      external_id: 'u1@league',
    });

    const workspace = new FakeProvisioningService();
    const svc = makeService(fake, workspace);
    const result = await svc.provisionGroup(group.id, 'workspace', ACTOR_ID);
    expect(result.succeeded).toEqual([u2.id]);
    expect(workspace.calls).toEqual([u2.id]);
  });

  it('fail-soft on a per-user error', async () => {
    const group = await makeGroup();
    const u = await makeUser({ display_name: 'Prov Fail' });
    await makeMembership(group, u);
    const workspace = new FakeProvisioningService();
    workspace.queueError(new Error('provision boom'));

    const svc = makeService(fake, workspace);
    const result = await svc.provisionGroup(group.id, 'workspace', ACTOR_ID);
    expect(result.succeeded).toEqual([]);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0].userName).toBe('Prov Fail');
    expect(result.failed[0].error).toBe('provision boom');
  });

  it('throws when provisioner is not wired', async () => {
    const group = await makeGroup();
    const svc = makeService(fake); // no workspace / claude provisioner
    await expect(
      svc.provisionGroup(group.id, 'workspace', ACTOR_ID),
    ).rejects.toThrow(/not wired/);
  });
});
