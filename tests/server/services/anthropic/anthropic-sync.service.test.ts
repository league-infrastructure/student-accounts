/**
 * Integration tests for AnthropicSyncService (Sprint 010 T011).
 *
 * Covers:
 *  - 3 org users, 1 matching local user → creates 1 link, 2 unmatched.
 *  - Pending invite accepted → ExternalAccount transitions active,
 *    addUserToWorkspace called.
 *  - Local claude ExternalAccount with unknown external_id → transitions to
 *    removed, audit event emitted.
 *  - Org user already linked (existing ExternalAccount) → not duplicated.
 *  - Local user with active claude account → skipped (no duplicate).
 *  - Students workspace resolved from listWorkspaces by name.
 *  - CLAUDE_STUDENT_WORKSPACE env var controls workspace name.
 *  - Workspace not found → throws.
 */

import { prisma } from '../../../../server/src/services/prisma.js';
import { AuditService } from '../../../../server/src/services/audit.service.js';
import { AnthropicSyncService } from '../../../../server/src/services/anthropic/anthropic-sync.service.js';
import { FakeAnthropicAdminClient } from '../../helpers/fake-anthropic-admin.client.js';
import { makeUser, makeExternalAccount } from '../../helpers/factories.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearDb() {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

function makeService(fake: FakeAnthropicAdminClient): AnthropicSyncService {
  return new AnthropicSyncService(fake, prisma, new AuditService());
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let fakeClient: FakeAnthropicAdminClient;
let originalStudentsWorkspaceEnv: string | undefined;

beforeEach(async () => {
  await clearDb();
  fakeClient = new FakeAnthropicAdminClient();
  // Provide a default Students workspace
  fakeClient.configure('listWorkspaces', [{ id: 'ws-students-001', name: 'Students' }]);
  originalStudentsWorkspaceEnv = process.env.CLAUDE_STUDENT_WORKSPACE;
  delete process.env.CLAUDE_STUDENT_WORKSPACE;
});

afterEach(() => {
  if (originalStudentsWorkspaceEnv !== undefined) {
    process.env.CLAUDE_STUDENT_WORKSPACE = originalStudentsWorkspaceEnv;
  } else {
    delete process.env.CLAUDE_STUDENT_WORKSPACE;
  }
});

// ---------------------------------------------------------------------------
// Pass 1: Link by email
// ---------------------------------------------------------------------------

describe('AnthropicSyncService.reconcile — link by email', () => {
  it('creates 1 ExternalAccount link for 1 matching user out of 3 org users', async () => {
    // Create only one local user that matches one of the three org users
    const matchedUser = await makeUser({ primary_email: 'alice@students.jointheleague.org' });
    // Two org users have no matching local user
    fakeClient.configure('listOrgUsers', {
      data: [
        { id: 'org-user-001', email: 'alice@students.jointheleague.org', role: 'user' },
        { id: 'org-user-002', email: 'bob@example.com', role: 'user' },
        { id: 'org-user-003', email: 'carol@example.com', role: 'user' },
      ],
      nextCursor: undefined,
    });

    const svc = makeService(fakeClient);
    const report = await svc.reconcile(null);

    expect(report.created).toBe(1);
    expect(report.linked).toBe(1);
    expect(report.unmatched).toHaveLength(2);
    expect(report.unmatched).toContain('bob@example.com');
    expect(report.unmatched).toContain('carol@example.com');

    // Verify the ExternalAccount was created
    const accounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: matchedUser.id, type: 'claude' },
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].status).toBe('active');
    expect(accounts[0].external_id).toBe('org-user-001');
  });

  it('does not create a duplicate if user already has a linked claude ExternalAccount', async () => {
    const user = await makeUser({ primary_email: 'alice@students.jointheleague.org' });
    // Pre-existing active claude account with the same external_id
    await makeExternalAccount(user, {
      type: 'claude',
      status: 'active',
      external_id: 'org-user-001',
    });

    fakeClient.configure('listOrgUsers', {
      data: [{ id: 'org-user-001', email: 'alice@students.jointheleague.org', role: 'user' }],
      nextCursor: undefined,
    });

    const svc = makeService(fakeClient);
    const report = await svc.reconcile(null);

    expect(report.created).toBe(0);
    expect(report.unmatched).toHaveLength(0);

    const accounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: user.id, type: 'claude' },
    });
    expect(accounts).toHaveLength(1);
  });

  it('email matching is case-insensitive', async () => {
    // Local user email is lowercase; org user email has mixed case
    await makeUser({ primary_email: 'alice@students.jointheleague.org' });
    fakeClient.configure('listOrgUsers', {
      data: [{ id: 'org-user-001', email: 'Alice@Students.JoinTheLeague.org', role: 'user' }],
      nextCursor: undefined,
    });

    const svc = makeService(fakeClient);
    const report = await svc.reconcile(null);

    expect(report.created).toBe(1);
    expect(report.unmatched).toHaveLength(0);
  });

  it('emits a claude_sync_linked audit event for each linked account', async () => {
    const user = await makeUser({ primary_email: 'alice@students.jointheleague.org' });
    fakeClient.configure('listOrgUsers', {
      data: [{ id: 'org-user-001', email: 'alice@students.jointheleague.org', role: 'user' }],
      nextCursor: undefined,
    });

    const svc = makeService(fakeClient);
    await svc.reconcile(null);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'claude_sync_linked', target_user_id: user.id },
    });
    expect(events).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Pass 2: Invite-accepted transition
// ---------------------------------------------------------------------------

describe('AnthropicSyncService.reconcile — invite accepted', () => {
  it('transitions pending ExternalAccount to active when invite email appears in org users', async () => {
    // CLAUDE_STUDENT_WORKSPACE opts us in to the workspace-add side effect.
    process.env.CLAUDE_STUDENT_WORKSPACE = 'Students';
    const user = await makeUser({ primary_email: 'bob@students.jointheleague.org' });
    // Local ExternalAccount with external_id = invite id
    const pendingAccount = await makeExternalAccount(user, {
      type: 'claude',
      status: 'pending',
      external_id: 'invite-abc-123',
    });

    // Invite is present in the invites list
    fakeClient.configure('listInvites', {
      data: [
        {
          id: 'invite-abc-123',
          email: 'bob@students.jointheleague.org',
          role: 'user',
          status: 'pending',
        },
      ],
      nextCursor: undefined,
    });

    // The invite email now appears as an org user (invite accepted)
    fakeClient.configure('listOrgUsers', {
      data: [{ id: 'org-user-bob-999', email: 'bob@students.jointheleague.org', role: 'user' }],
      nextCursor: undefined,
    });

    const svc = makeService(fakeClient);
    const report = await svc.reconcile(null);

    expect(report.invitedAccepted).toBe(1);

    // ExternalAccount should be updated to active with the new org user id
    const updated = await (prisma as any).externalAccount.findUnique({
      where: { id: pendingAccount.id },
    });
    expect(updated.status).toBe('active');
    expect(updated.external_id).toBe('org-user-bob-999');

    // addUserToWorkspace should have been called
    expect(fakeClient.calls.addUserToWorkspace).toHaveLength(1);
    expect(fakeClient.calls.addUserToWorkspace[0]).toMatchObject({
      workspaceId: 'ws-students-001',
      userId: 'org-user-bob-999',
    });
  });

  it('emits a claude_sync_invite_accepted audit event', async () => {
    const user = await makeUser({ primary_email: 'bob@students.jointheleague.org' });
    const pendingAccount = await makeExternalAccount(user, {
      type: 'claude',
      status: 'pending',
      external_id: 'invite-abc-123',
    });

    fakeClient.configure('listInvites', {
      data: [
        {
          id: 'invite-abc-123',
          email: 'bob@students.jointheleague.org',
          role: 'user',
          status: 'pending',
        },
      ],
      nextCursor: undefined,
    });
    fakeClient.configure('listOrgUsers', {
      data: [{ id: 'org-user-bob-999', email: 'bob@students.jointheleague.org', role: 'user' }],
      nextCursor: undefined,
    });

    const svc = makeService(fakeClient);
    await svc.reconcile(null);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'claude_sync_invite_accepted', target_user_id: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].target_entity_id).toBe(String(pendingAccount.id));
  });

  it('does not transition pending account if invite email is not yet in org users', async () => {
    const user = await makeUser({ primary_email: 'pending@students.jointheleague.org' });
    const pendingAccount = await makeExternalAccount(user, {
      type: 'claude',
      status: 'pending',
      external_id: 'invite-still-pending',
    });

    fakeClient.configure('listInvites', {
      data: [
        {
          id: 'invite-still-pending',
          email: 'pending@students.jointheleague.org',
          role: 'user',
          status: 'pending',
        },
      ],
      nextCursor: undefined,
    });
    // No matching org user
    fakeClient.configure('listOrgUsers', { data: [], nextCursor: undefined });

    const svc = makeService(fakeClient);
    const report = await svc.reconcile(null);

    expect(report.invitedAccepted).toBe(0);

    const notUpdated = await (prisma as any).externalAccount.findUnique({
      where: { id: pendingAccount.id },
    });
    expect(notUpdated.status).toBe('pending');
    expect(fakeClient.calls.addUserToWorkspace).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pass 3: Stale removal
// ---------------------------------------------------------------------------

describe('AnthropicSyncService.reconcile — stale removal', () => {
  it('flags local claude ExternalAccount with unknown external_id as removed', async () => {
    const user = await makeUser();
    const staleAccount = await makeExternalAccount(user, {
      type: 'claude',
      status: 'active',
      external_id: 'stale-id-not-in-api',
    });

    // API returns nothing for this id
    fakeClient.configure('listOrgUsers', { data: [], nextCursor: undefined });
    fakeClient.configure('listInvites', { data: [], nextCursor: undefined });

    const svc = makeService(fakeClient);
    const report = await svc.reconcile(null);

    expect(report.removed).toBe(1);

    const updated = await (prisma as any).externalAccount.findUnique({
      where: { id: staleAccount.id },
    });
    expect(updated.status).toBe('removed');
  });

  it('emits a claude_sync_flagged audit event for each stale account', async () => {
    const user = await makeUser();
    const staleAccount = await makeExternalAccount(user, {
      type: 'claude',
      status: 'active',
      external_id: 'stale-id-not-in-api',
    });

    fakeClient.configure('listOrgUsers', { data: [], nextCursor: undefined });
    fakeClient.configure('listInvites', { data: [], nextCursor: undefined });

    const svc = makeService(fakeClient);
    await svc.reconcile(null);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'claude_sync_flagged', target_user_id: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].target_entity_id).toBe(String(staleAccount.id));
  });

  it('does not flag already-removed accounts again', async () => {
    const user = await makeUser();
    await makeExternalAccount(user, {
      type: 'claude',
      status: 'removed',
      external_id: 'already-removed-id',
    });

    fakeClient.configure('listOrgUsers', { data: [], nextCursor: undefined });
    fakeClient.configure('listInvites', { data: [], nextCursor: undefined });

    const svc = makeService(fakeClient);
    const report = await svc.reconcile(null);

    expect(report.removed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Workspace resolution
// ---------------------------------------------------------------------------

describe('AnthropicSyncService — workspace resolution (opt-in)', () => {
  it('returns null when CLAUDE_STUDENT_WORKSPACE is unset — sync runs without workspace-add', async () => {
    // No env var set (beforeEach deletes it).
    const svc = makeService(fakeClient);
    const wsId = await svc.resolveStudentsWorkspace();
    expect(wsId).toBeNull();
  });

  it('resolves workspace by name when CLAUDE_STUDENT_WORKSPACE is set', async () => {
    process.env.CLAUDE_STUDENT_WORKSPACE = 'Students';
    fakeClient.configure('listWorkspaces', [
      { id: 'ws-other', name: 'OtherWorkspace' },
      { id: 'ws-students-001', name: 'Students' },
    ]);

    const svc = makeService(fakeClient);
    const wsId = await svc.resolveStudentsWorkspace();

    expect(wsId).toBe('ws-students-001');
  });

  it('uses CLAUDE_STUDENT_WORKSPACE env var as the target name', async () => {
    process.env.CLAUDE_STUDENT_WORKSPACE = 'Learners';
    fakeClient.configure('listWorkspaces', [
      { id: 'ws-learners-999', name: 'Learners' },
    ]);

    const svc = makeService(fakeClient);
    const wsId = await svc.resolveStudentsWorkspace();

    expect(wsId).toBe('ws-learners-999');
  });

  it('caches the workspace ID (listWorkspaces called only once) when configured', async () => {
    process.env.CLAUDE_STUDENT_WORKSPACE = 'Students';
    fakeClient.configure('listWorkspaces', [{ id: 'ws-students-001', name: 'Students' }]);
    fakeClient.configure('listOrgUsers', { data: [], nextCursor: undefined });
    fakeClient.configure('listInvites', { data: [], nextCursor: undefined });

    const svc = makeService(fakeClient);
    await svc.reconcile(null);
    await svc.reconcile(null);

    expect(fakeClient.calls.listWorkspaces).toHaveLength(1);
  });

  it('returns null (instead of throwing) when the named workspace is not found', async () => {
    process.env.CLAUDE_STUDENT_WORKSPACE = 'Students';
    fakeClient.configure('listWorkspaces', [{ id: 'ws-other', name: 'OtherWorkspace' }]);

    const svc = makeService(fakeClient);
    await expect(svc.resolveStudentsWorkspace()).resolves.toBeNull();
  });
});
