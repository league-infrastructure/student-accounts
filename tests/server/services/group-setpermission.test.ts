/**
 * Integration tests for GroupService.setPermission and addMember provisioning
 * fan-out (Sprint 026 T005).
 *
 * Uses a real SQLite test database. WorkspaceProvisioningService is injected
 * as a mock/spy so tests do not hit the Google Admin SDK.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { GroupService } from '../../../server/src/services/group.service.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { NotFoundError } from '../../../server/src/errors.js';
import { makeUser, makeGroup, makeMembership, makeExternalAccount } from '../helpers/factories.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

async function resetDb() {
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

beforeEach(resetDb);

/**
 * Build a minimal WorkspaceProvisioningService stub. The `provision` spy
 * resolves by default and can be overridden to reject in individual tests.
 */
function makeProvisioningStub() {
  const provision = vi.fn().mockResolvedValue({ id: 999, type: 'workspace' });
  return { provision } as any;
}

// ---------------------------------------------------------------------------
// setPermission — basic column updates and audit events
// ---------------------------------------------------------------------------

describe('GroupService.setPermission — column update + audit', () => {
  it('updates allows_oauth_client and writes group_permission_changed audit event', async () => {
    const audit = new AuditService();
    const service = new GroupService(prisma, audit);
    const actor = await makeUser({ role: 'admin' });
    const g = await makeGroup();

    const updated = await service.setPermission(g.id, 'oauthClient', true, actor.id);

    expect((updated as any).allows_oauth_client).toBe(true);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'group_permission_changed', target_entity_id: String(g.id) },
    });
    expect(events.length).toBe(1);
    expect((events[0].details as any).permission).toBe('oauthClient');
    expect((events[0].details as any).old).toBe(false);
    expect((events[0].details as any).new).toBe(true);
    expect(events[0].actor_user_id).toBe(actor.id);
  });

  it('updates allows_llm_proxy and writes audit event', async () => {
    const audit = new AuditService();
    const service = new GroupService(prisma, audit);
    const actor = await makeUser({ role: 'admin' });
    const g = await makeGroup();

    const updated = await service.setPermission(g.id, 'llmProxy', true, actor.id);

    expect((updated as any).allows_llm_proxy).toBe(true);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'group_permission_changed', target_entity_id: String(g.id) },
    });
    expect(events.length).toBe(1);
    expect((events[0].details as any).permission).toBe('llmProxy');
  });

  it('updates allows_league_account and writes audit event', async () => {
    const audit = new AuditService();
    const service = new GroupService(prisma, audit);
    const actor = await makeUser({ role: 'admin' });
    const g = await makeGroup();

    const updated = await service.setPermission(g.id, 'leagueAccount', true, actor.id);

    expect((updated as any).allows_league_account).toBe(true);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'group_permission_changed', target_entity_id: String(g.id) },
    });
    expect(events.length).toBe(1);
    expect((events[0].details as any).permission).toBe('leagueAccount');
  });

  it('throws NotFoundError when group does not exist', async () => {
    const audit = new AuditService();
    const service = new GroupService(prisma, audit);
    const actor = await makeUser({ role: 'admin' });

    await expect(
      service.setPermission(99999, 'oauthClient', true, actor.id),
    ).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// setPermission — no provisioning for oauthClient / llmProxy
// ---------------------------------------------------------------------------

describe('GroupService.setPermission — oauthClient/llmProxy does not trigger provisioning', () => {
  it('does not call provision when toggling oauthClient', async () => {
    const audit = new AuditService();
    const stub = makeProvisioningStub();
    const service = new GroupService(prisma, audit, stub);
    const actor = await makeUser({ role: 'admin' });
    const g = await makeGroup();
    const member = await makeUser({ role: 'student' });
    await makeMembership(g, member);

    await service.setPermission(g.id, 'oauthClient', true, actor.id);

    expect(stub.provision).not.toHaveBeenCalled();
  });

  it('does not call provision when toggling llmProxy', async () => {
    const audit = new AuditService();
    const stub = makeProvisioningStub();
    const service = new GroupService(prisma, audit, stub);
    const actor = await makeUser({ role: 'admin' });
    const g = await makeGroup();
    const member = await makeUser({ role: 'student' });
    await makeMembership(g, member);

    await service.setPermission(g.id, 'llmProxy', true, actor.id);

    expect(stub.provision).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setPermission — leagueAccount fan-out
// ---------------------------------------------------------------------------

describe('GroupService.setPermission — leagueAccount=true fan-out', () => {
  it('calls provision for each member without an active workspace account', async () => {
    const audit = new AuditService();
    const stub = makeProvisioningStub();
    const service = new GroupService(prisma, audit, stub);
    const actor = await makeUser({ role: 'admin' });
    const g = await makeGroup();

    // Three members, none with workspace accounts.
    const m1 = await makeUser({ role: 'student' });
    const m2 = await makeUser({ role: 'student' });
    const m3 = await makeUser({ role: 'student' });
    await makeMembership(g, m1);
    await makeMembership(g, m2);
    await makeMembership(g, m3);

    await service.setPermission(g.id, 'leagueAccount', true, actor.id);

    // provision should have been called once per unprovisioned member
    expect(stub.provision).toHaveBeenCalledTimes(3);
    const calledUserIds = stub.provision.mock.calls.map((c: any[]) => c[0]);
    expect(calledUserIds).toContain(m1.id);
    expect(calledUserIds).toContain(m2.id);
    expect(calledUserIds).toContain(m3.id);
  });

  it('skips members who already have an active workspace ExternalAccount', async () => {
    const audit = new AuditService();
    const stub = makeProvisioningStub();
    const service = new GroupService(prisma, audit, stub);
    const actor = await makeUser({ role: 'admin' });
    const g = await makeGroup();

    const provisioned = await makeUser({ role: 'student' });
    const unprovisioned = await makeUser({ role: 'student' });
    await makeMembership(g, provisioned);
    await makeMembership(g, unprovisioned);

    // Give provisioned user an active workspace account.
    await makeExternalAccount(provisioned, { type: 'workspace', status: 'active' });

    await service.setPermission(g.id, 'leagueAccount', true, actor.id);

    // Only the unprovisioned member should be provisioned.
    expect(stub.provision).toHaveBeenCalledTimes(1);
    expect(stub.provision.mock.calls[0][0]).toBe(unprovisioned.id);
  });

  it('skips members who have a pending (not yet active) workspace account', async () => {
    const audit = new AuditService();
    const stub = makeProvisioningStub();
    const service = new GroupService(prisma, audit, stub);
    const actor = await makeUser({ role: 'admin' });
    const g = await makeGroup();

    const pendingMember = await makeUser({ role: 'student' });
    await makeMembership(g, pendingMember);
    await makeExternalAccount(pendingMember, { type: 'workspace', status: 'pending' });

    await service.setPermission(g.id, 'leagueAccount', true, actor.id);

    // pending counts as already-provisioned — skip.
    expect(stub.provision).not.toHaveBeenCalled();
  });

  it('is fail-soft — continues when provision throws for one member', async () => {
    const audit = new AuditService();
    const stub = makeProvisioningStub();
    const service = new GroupService(prisma, audit, stub);
    const actor = await makeUser({ role: 'admin' });
    const g = await makeGroup();

    const m1 = await makeUser({ role: 'student' });
    const m2 = await makeUser({ role: 'student' });
    await makeMembership(g, m1);
    await makeMembership(g, m2);

    // First call throws; second should still succeed.
    stub.provision
      .mockRejectedValueOnce(new Error('Google API error'))
      .mockResolvedValueOnce({ id: 999, type: 'workspace' });

    // Should NOT throw even though provisioning for one member failed.
    await expect(
      service.setPermission(g.id, 'leagueAccount', true, actor.id),
    ).resolves.not.toThrow();

    expect(stub.provision).toHaveBeenCalledTimes(2);
  });

  it('does NOT trigger provisioning when toggling leagueAccount to false', async () => {
    const audit = new AuditService();
    const stub = makeProvisioningStub();
    const service = new GroupService(prisma, audit, stub);
    const actor = await makeUser({ role: 'admin' });

    // Create a group already flagged on, then toggle off.
    const g = await (prisma as any).group.create({
      data: {
        name: `perm-off-${Date.now()}`,
        allows_league_account: true,
      },
    });
    const member = await makeUser({ role: 'student' });
    await makeMembership(g, member);

    await service.setPermission(g.id, 'leagueAccount', false, actor.id);

    expect(stub.provision).not.toHaveBeenCalled();
  });

  it('does NOT delete existing workspace accounts when toggling leagueAccount off', async () => {
    const audit = new AuditService();
    const stub = makeProvisioningStub();
    const service = new GroupService(prisma, audit, stub);
    const actor = await makeUser({ role: 'admin' });

    const g = await (prisma as any).group.create({
      data: {
        name: `perm-off-no-delete-${Date.now()}`,
        allows_league_account: true,
      },
    });
    const member = await makeUser({ role: 'student' });
    await makeMembership(g, member);
    const existingAccount = await makeExternalAccount(member, {
      type: 'workspace',
      status: 'active',
    });

    await service.setPermission(g.id, 'leagueAccount', false, actor.id);

    // Account must still exist and still be active.
    const found = await (prisma as any).externalAccount.findUnique({
      where: { id: existingAccount.id },
    });
    expect(found).not.toBeNull();
    expect(found.status).toBe('active');
  });

  it('is a no-op when the group has no members', async () => {
    const audit = new AuditService();
    const stub = makeProvisioningStub();
    const service = new GroupService(prisma, audit, stub);
    const actor = await makeUser({ role: 'admin' });
    const g = await makeGroup();

    await service.setPermission(g.id, 'leagueAccount', true, actor.id);

    expect(stub.provision).not.toHaveBeenCalled();
  });

  it('skips fan-out silently when WorkspaceProvisioningService is not wired', async () => {
    const audit = new AuditService();
    // No provisioning service injected.
    const service = new GroupService(prisma, audit);
    const actor = await makeUser({ role: 'admin' });
    const g = await makeGroup();
    const member = await makeUser({ role: 'student' });
    await makeMembership(g, member);

    // Should resolve without error.
    await expect(
      service.setPermission(g.id, 'leagueAccount', true, actor.id),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// addMember — provisioning fan-out
// ---------------------------------------------------------------------------

describe('GroupService.addMember — provisioning fan-out', () => {
  it('provisions a workspace account when group has allowsLeagueAccount=true and member has none', async () => {
    const audit = new AuditService();
    const stub = makeProvisioningStub();
    const service = new GroupService(prisma, audit, stub);
    const actor = await makeUser({ role: 'admin' });

    const g = await (prisma as any).group.create({
      data: {
        name: `addm-league-${Date.now()}`,
        allows_league_account: true,
      },
    });
    const member = await makeUser({ role: 'student' });

    await service.addMember(g.id, member.id, actor.id);

    expect(stub.provision).toHaveBeenCalledTimes(1);
    expect(stub.provision.mock.calls[0][0]).toBe(member.id);
    expect(stub.provision.mock.calls[0][1]).toBe(actor.id);
  });

  it('does NOT provision when the group has allowsLeagueAccount=false', async () => {
    const audit = new AuditService();
    const stub = makeProvisioningStub();
    const service = new GroupService(prisma, audit, stub);
    const actor = await makeUser({ role: 'admin' });

    const g = await (prisma as any).group.create({
      data: {
        name: `addm-no-league-${Date.now()}`,
        allows_league_account: false,
      },
    });
    const member = await makeUser({ role: 'student' });

    await service.addMember(g.id, member.id, actor.id);

    expect(stub.provision).not.toHaveBeenCalled();
  });

  it('does NOT provision when the new member already has an active workspace account', async () => {
    const audit = new AuditService();
    const stub = makeProvisioningStub();
    const service = new GroupService(prisma, audit, stub);
    const actor = await makeUser({ role: 'admin' });

    const g = await (prisma as any).group.create({
      data: {
        name: `addm-already-${Date.now()}`,
        allows_league_account: true,
      },
    });
    const member = await makeUser({ role: 'student' });
    await makeExternalAccount(member, { type: 'workspace', status: 'active' });

    await service.addMember(g.id, member.id, actor.id);

    expect(stub.provision).not.toHaveBeenCalled();
  });

  it('is fail-soft — addMember succeeds even when provisioning throws', async () => {
    const audit = new AuditService();
    const stub = makeProvisioningStub();
    stub.provision.mockRejectedValue(new Error('Google API error'));
    const service = new GroupService(prisma, audit, stub);
    const actor = await makeUser({ role: 'admin' });

    const g = await (prisma as any).group.create({
      data: {
        name: `addm-failsoft-${Date.now()}`,
        allows_league_account: true,
      },
    });
    const member = await makeUser({ role: 'student' });

    // addMember should not throw even though provisioning failed.
    await expect(service.addMember(g.id, member.id, actor.id)).resolves.not.toThrow();

    // Membership row should still exist.
    const row = await (prisma as any).userGroup.findUnique({
      where: { user_id_group_id: { user_id: member.id, group_id: g.id } },
    });
    expect(row).not.toBeNull();
  });
});
